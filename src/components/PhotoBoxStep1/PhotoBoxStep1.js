import { h, Component } from 'preact';
import Icon from '../Icon';
import {
  PhotoBoxActionBar,
  PhotoBoxActionBarList,
  PhotoBoxActionBarItem
} from '../PhotoBoxActionBar/PhotoBoxActionBar';
import withCSS from '../withCSS';
import css from './PhotoBoxStep1.css.js';
import { dataUrlToBlob } from '../../util/blob';

class PhotoBoxStep1 extends Component {
  constructor(...args) {
    super(...args);
    this.state = {};
    this.handleActionBoxClick = (e) => {
      this.$fileChooser.dispatchEvent(
        new MouseEvent('click', {
          'view': window,
          'bubbles': false,
          'cancelable': true
        })
      );
    };
    this._handleFileInputChange = (e) => {
      const selectedFile = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64Data = e.target.result;
        this.props.selectFile({
          name: selectedFile.name,
          size: selectedFile.size,
          type: selectedFile.type,
          base64: base64Data,
          blob: dataUrlToBlob(base64Data)
        });
      };
      reader.readAsDataURL(selectedFile);
    };
  }
  componentDidMount() {
    this.$fileChooser.addEventListener('change', this._handleFileInputChange);
  }
  render({}, {}, { options }) {
    const { className } = options;
    return (
      <div>
        <div class={`${className}-primaryBox`}>
          <div
            class={`${className}-step1-actionBox`}
            onClick={this.handleActionBoxClick}
          >
            <div class={`${className}-step1-actionBox-content`}>
              <div class={`${className}-step1-actionBox-content-picWrap`}>
                <div class={`${className}-step1-actionBox-content-pic`}>
                  <Icon name="add-photo" />
                </div>
              </div>
              <div class={`${className}-step1-actionBox-content-choose`}>
                Choose Photo
              </div>
              <div class={`${className}-step1-actionBox-content-drag`}>
                or drag an image here
              </div>
              <input
                type="file"
                accept="image/*"
                class={`${className}-step1-actionBox-file-chooser`}
                ref={($el) => this.$fileChooser = $el}
              />
            </div>
          </div>
        </div>
        <PhotoBoxActionBar>
          <div style={{ textAlign: 'center' }}>
            <PhotoBoxActionBarList>
              <PhotoBoxActionBarItem isSelected={true} icon="upload" />
              <PhotoBoxActionBarItem isSelected={false} icon="take-picture" />
            </PhotoBoxActionBarList>
          </div>
        </PhotoBoxActionBar>
      </div>
    );
  }
}

export default withCSS(PhotoBoxStep1, css);
