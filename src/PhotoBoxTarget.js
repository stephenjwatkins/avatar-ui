export class NullPhotoBoxTarget {
  init() {
    return this;
  }
  destroy() {
  }
  position() {
  }
}

export class PhotoBoxTarget {
  constructor(photoBox, $target, options = {}) {
    this.photoBox = photoBox;
    this.$target = $target;
    this.options = options;

    this._handleTargetClick = this._handleTargetClick.bind(this);
    this._handleWindowResize = this._handleWindowResize.bind(this);

    this.$target.addEventListener('click', this._handleTargetClick);
    window.addEventListener('resize', this._handleWindowResize);

    this.photoBox.events.on('position:target', () => {
      this.position();
    });
  }
  _handleTargetClick(e) {
    e.stopPropagation();
    this.photoBox.toggle();
  }
  _handleWindowResize(e) {
    this.position();
  }
  destroy() {
    this.$target.removeEventListener('click', this._handleTargetClick);
    window.removeEventListener('resize', this._handleWindowResize);
  }
  position() {
    const rect = this.$target.getBoundingClientRect();
    this.photoBox.setPosition({
      top: rect.top + rect.height + (6 * 2),
      left: rect.left - ((this.photoBox.$el.offsetWidth / 2) - (rect.width / 2)),
    });
  }
}
