import { h, render } from 'preact';
import Events from './util/Events';
import PhotoBoxComponent from './components/PhotoBox/PhotoBox';
import { PhotoBoxTarget, NullPhotoBoxTarget } from './PhotoBoxTarget';

class PhotoBox {
  constructor(options = {}) {
    this.$container = document.querySelector('body');
    this.events = new Events();
    const defaults = {
      colors: {
        base: '#fff',
        accent: '#455054',
        emphasis: '#4c9501'
      },
      attachToTarget: null,
      className: 'PhotoBox',
      size: 240,
    };
    this.opened = false;
    options.size = Math.max(Math.min(320, options.size), 120);
    this.options = Object.assign({}, defaults, options);

    this.target = (
      this.options.attachToTarget
      ? new PhotoBoxTarget(this, this.options.attachToTarget)
      : new NullPhotoBoxTarget()
    );

    this._handleDocumentClick = this._handleDocumentClick.bind(this);
    this._handleDocumentKeyup = this._handleDocumentKeyup.bind(this);

    document.addEventListener('click', this._handleDocumentClick);
    document.addEventListener('keyup', this._handleDocumentKeyup);

    this.$el = document.createElement('div');
    this.$el.classList.add(`${this.options.className}Container`);
    this.$el.addEventListener('click', (e) => { e.stopPropagation(); });
    this.$elPreact = render((
      <PhotoBoxComponent
        options={this.options}
        events={this.events}
      />
    ), this.$el);

    this.$container.appendChild(this.$el);
  }
  _handleDocumentClick(e) {
    this.close();
  }
  _handleDocumentKeyup(e) {
    if (e.keyCode === 27) {
      this.close();
    }
  }
  destroy() {
    document.removeEventListener('click', this._handleDocumentClick);
    document.removeEventListener('keyup', this._handleDocumentKeyup);

    render(h(() => null), this.$el, this.$elPreact);
    this.$el.parentNode.removeChild(this.$el);

    this.target.destroy();
  }
  toggle() {
    this.opened ? this.close() : this.open();
  }
  open() {
    this.opened = true;
    this.$el.style.opacity = 1;
    this.$el.style.pointerEvents = 'auto';
    this.target.position();
  }
  close() {
    this.$el.style.opacity = 0;
    this.$el.style.pointerEvents = 'none';
    this.opened = false;
  }
  setPosition({ top, left }) {
    (window.requestIdleCallback || window.setTimeout)(() => {
      this.$el.style.top = `${top}px`;
      this.$el.style.left = `${left}px`;
      this.events.fire('position', { top, left });
    });
  }
}

export default PhotoBox;
