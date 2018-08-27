import { h, Component } from 'preact';
import Icon from '../Icon';
import {
  PhotoBoxActionBar,
  PhotoBoxActionBarList,
  PhotoBoxActionBarItem
} from '../PhotoBoxActionBar/PhotoBoxActionBar';
import Slider from '../Slider/Slider';
import { classnames } from '../../util/classnames';
import MouseDragger from '../MouseDragger';
import withCSS from '../withCSS';
import css from './PhotoBoxStep2.css.js';
import { dataUrlToBlob, dataUrlToBlob2 } from '../../util/blob';

class PhotoBoxStep2 extends Component {
  constructor(...args) {
    super(...args);
    const frameSize = this.context.options.size;
    this.state = {
      imageSize: frameSize,
      imageX: 10,
      imageY: 10,
      dragging: false,
    };

    this.handleSaveClick = () => {
      const { selectedFile, processFile } = this.props;

      const newCanvas = document.createElement('canvas');
      const newContext = newCanvas.getContext('2d');

      newCanvas.width = frameSize;
      newCanvas.height = frameSize;

      newContext.drawImage(this.canvas, -10, -10);

      const base64Data = newCanvas.toDataURL("image/jpeg");
      const blob = dataUrlToBlob(base64Data);

      processFile({
        name: selectedFile.name,
        size: blob.size,
        type: blob.type,
        base64: base64Data,
        blob: blob,
      });
    };

    this.onSliderChange = (percent) => {
      const changes = {};
      const newImageSize = frameSize * (1.0 + percent);

      const { imageX, imageY } = this.state;
      if ((imageX + newImageSize) < (frameSize + 10)) {
        changes.imageX = (frameSize + 10) - newImageSize;
      }
      if ((imageY + newImageSize) < (frameSize + 10)) {
        changes.imageY = (frameSize + 10) - newImageSize;
      }

      changes.imageSize = newImageSize;
      this.setState(changes);
    };

    this.handleMouseDraggerChange = ({ deltaX, deltaY, pressed }) => {
      const { imageX, imageY, imageSize } = this.state;

      let newImageX = Math.min(10, imageX + deltaX);
      let newImageY = Math.min(10, imageY + deltaY);

      if ((newImageX + imageSize) < (frameSize + 10)) {
        newImageX = (frameSize + 10) - imageSize;
      }
      if ((newImageY + imageSize) < (frameSize + 10)) {
        newImageY = (frameSize + 10) - imageSize;
      }

      this.setState({
        imageX: newImageX,
        imageY: newImageY,
        dragging: pressed,
      });
    };

    this._drawImage = (imgDataAsBase64) => {
      const { size } = this.context.options;
      const { imageSize, imageX, imageY } = this.state;
      // const offset = (imageSize - (size + (10 * 2))) / -2;
      const img = new Image();
      img.onload = () => {
        const context = this.canvas.getContext('2d');
        context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        context.drawImage(img, imageX, imageY, imageSize, imageSize);
      };
      img.src = imgDataAsBase64;
    };
  }
  componentDidMount() {
    const { selectedFile } = this.props;
    const { imageSize } = this.state;
    const { options } = this.context;

    // TODO: Magic number (padding)
    const canvasSize = imageSize + (10 * 2);
    const canvas = document.createElement('canvas');
    this.canvas = canvas;
    canvas.width =canvasSize;
    canvas.height = canvasSize;
    this.$preview.appendChild(canvas);

    this.drawImage = () => this._drawImage(selectedFile.base64);
    this.drawImage();
  }
  componentDidUpdate(prevProps, prevState) {
    if (
      (this.state.imageSize !== prevState.imageSize) ||
      (this.state.imageX !== prevState.imageX) ||
      (this.state.imageY !== prevState.imageY)
    ) {
      this.drawImage();
    }
  }
  render({}, { dragging }, { options }) {
    const { className } = options;
    return (
      <div>
        <div class={classnames({
          [`${className}-primaryBox`]: true,
          'is-dragging': dragging,
        })}>
          <div
            class={`${className}-step2-canvas`}
            ref={($el) => this.$preview = $el}
          />
          <div class={`${className}-step2-frame`} />
          <MouseDragger onChange={this.handleMouseDraggerChange}>
            <div class={`${className}-step2-actionBox`} />
          </MouseDragger>
          <div class={`${className}-step2-slider`}>
            <Slider onChange={this.onSliderChange} />
          </div>
        </div>
        <PhotoBoxActionBar>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <PhotoBoxActionBarList>
              <PhotoBoxActionBarItem isSelected={true} icon="crop" />
              <PhotoBoxActionBarItem isSelected={false} icon="filters" />
            </PhotoBoxActionBarList>
            <PhotoBoxActionBarList>
              <PhotoBoxActionBarItem
                isEmphasized={true}
                icon="check"
                onPress={this.handleSaveClick}
              />
            </PhotoBoxActionBarList>
          </div>
        </PhotoBoxActionBar>
      </div>
    );
  }
}

export default withCSS(PhotoBoxStep2, css);
