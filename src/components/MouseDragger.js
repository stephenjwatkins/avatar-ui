import { h, Component, cloneElement } from 'preact';

class MouseDragger extends Component {
  constructor(...args) {
    super(...args);

    this.state = {
      x: 0, y: 0,
      deltaX: 0, deltaY: 0,
      pressed: false,
    };

    let prevX;
    let prevY;

    const setStateFromEvent = ({ e, pressed }) => {
      const x = e.offsetX;
      const y = e.offsetY;
      const deltaX = x - (prevX || x);
      const deltaY = y - (prevY || y);

      prevX = pressed ? x : null;
      prevY = pressed ? y : null;

      this.setState({ x, y, deltaX, deltaY, pressed }, () => {
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
  render({ children }, { x, y, deltaX, deltaY }) {
    const child = children[0];
    const el = (
      typeof child === 'function'
      ? child({ x, y, deltaX, deltaY })
      : child
    );
    return cloneElement(el, {
      onMouseDown: this.handleChange('MouseDown'),
      onMouseUp: this.handleChange('MouseUp'),
      onMouseLeave: this.handleChange('MouseLeave'),
      onMouseMove: this.handleChange('MouseMove')
    });
  }
}

export default MouseDragger;
