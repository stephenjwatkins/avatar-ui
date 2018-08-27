import { h, Component } from 'preact';

import SVGSymbols from '../SVGSymbols';
import PhotoBoxStep1 from '../PhotoBoxStep1/PhotoBoxStep1';
import PhotoBoxStep2 from '../PhotoBoxStep2/PhotoBoxStep2';
import PhotoBoxStep3 from '../PhotoBoxStep3/PhotoBoxStep3';
import PhotoBoxProgress from '../PhotoBoxProgress/PhotoBoxProgress';
import withCSS from '../withCSS';
import css from './PhotoBox.css.js';

class PhotoBox extends Component {
  constructor(...args) {
    super(...args);
    this.state = {
      step: 1,
      selectedFile: null,
      processedFile: null,
    };
    this.selectFile = (file) => {
      this.setState({ selectedFile: file, step: 2 });
    };
    this.processFile = (file) => {
      this.setState({ processedFile: file, step: 3 }, () => {
        this.props.events.fire('position:target');
      });
    };
  }
  getChildContext() {
    return {
      options: this.props.options,
      events: this.props.events,
    };
  }
  render({ options }, { step, selectedFile, processedFile }) {
    const { className } = options;
    return (
      <div className={className}>
        <SVGSymbols />
        <span class={`${className}-anchor`}></span>
        {step === 1 && (
          <PhotoBoxStep1 selectFile={this.selectFile} />
        )}
        {step === 2 && (
          <PhotoBoxStep2
            selectedFile={selectedFile}
            processFile={this.processFile}
          />
        )}
        {step === 3 && (
          <PhotoBoxStep3 processedFile={processedFile} />
        )}
        {step !== 3 && (
          <PhotoBoxProgress step={step} />
        )}
      </div>
    )
  }
}

export default withCSS(PhotoBox, css);
