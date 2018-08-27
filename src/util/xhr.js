export const sendFile = ({ url, file, onProgress, onComplete }) => {
  let data = new FormData();
  data.append('avatar', file.blob, file.name);

  const xhr = new XMLHttpRequest();
  xhr.upload.addEventListener('progress', (evt) => {
    if (evt.lengthComputable) {
      const { loaded, total } = evt;
      const percent = loaded / total;
      onProgress({ percent, loaded, total });
    } else {
      console.warn('Length not computable from the server.');
    }
  }, false);
  xhr.upload.addEventListener('load', (e) => {
    console.log('upload done');
    onComplete({ e, status: xhr.status });
  });
  xhr.upload.addEventListener('error', () => {
    console.log('upload failed');
  });
  xhr.upload.addEventListener('abort', () => {
    console.log('upload aborted');
  });

  xhr.open('POST', url, true);
  xhr.send(data);
};
