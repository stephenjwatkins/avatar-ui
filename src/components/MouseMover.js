import { h, Component, cloneElement } from 'preact';

class MouseMover extends Component {
  constructor(...args) {
    super(...args);

    this.state = { x: 0, y: 0, pressed: false };

    // Memoized values
    let _width;
    let _height;

    const setStateFromEvent = ({ e, pressed }) => {
      const width = _width || e.currentTarget.offsetWidth;
      const height = _height || e.currentTarget.offsetHeight;
      const x = Math.max(0, Math.min(100, e.offsetX / width));
      const y = Math.max(0, Math.min(100, e.offsetY / height));
      this.setState({ x, y, pressed }, () => {
        this.props.onChange(this.state);
      });
    };

    this.handleChange = (type) => (e) => {
      const { pressed } = this.state;
      switch (type) {
        case 'MouseDown':
          setStateFromEvent({ e, pressed: true });
          break;
        case 'MouseUp':
          if (pressed) {
            setStateFromEvent({ e, pressed: false });
          }
          break;
        case 'MouseMove':
          if (pressed) {
            setStateFromEvent({ e, pressed: true });
          }
          break;
        case 'MouseLeave':
          if (pressed) {
            setStateFromEvent({ e, pressed: false });
          }
          break;
        default:
          throw new Error('Invalid event type');
      }
    };
  }
  render({ children }, { x, y, pressed }) {
    const child = children[0];
    const el = typeof child === 'function' ? child({ x, y, pressed }) : child;
    return cloneElement(el, {
      onMouseDown: this.handleChange('MouseDown'),
      onMouseUp: this.handleChange('MouseUp'),
      onMouseLeave: this.handleChange('MouseLeave'),
      onMouseMove: this.handleChange('MouseMove')
    });
  }
}

export default MouseMover;
