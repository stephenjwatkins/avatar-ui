import { h, Component } from 'preact';
import withCSS from '../withCSS';
import css from './PhotoBoxStep3.css.js';
import { sendFile } from '../../util/xhr';

class PhotoBoxStep3 extends Component {
  constructor(...args) {
    super(...args);
    this.state = {
      progress: 0,
    };
  }
  componentDidMount() {
    const { processedFile } = this.props;
    console.log('uploading processed file', processedFile);
    sendFile({
      url: 'http://localhost:9001/upload',
      file: processedFile,
      onProgress: ({ percent, loaded, total }) => {
        console.log('upload progress', percent, loaded, total);
        this.setState({ progress: percent });
      },
      onComplete: ({ e, status }) => {
        console.log('done', status);
        this.setState({ progress: 1 });
      }
    });
  }
  render({ processedFile }, { progress }, { options }) {
    const { className } = options;
    return (
      <div class={`${className}-step3`}>
        <img src={processedFile.base64} />
        <div
          class={`${className}-step3-uploadBar`}
          style={{ width: `${progress * 100}%` }}
        />
        <div class={`${className}-step3-uploadText`}>
          {progress === 1 ? 'Uploaded' : 'Uploading'}
        </div>
      </div>
    );
  }
}

export default withCSS(PhotoBoxStep3, css);
