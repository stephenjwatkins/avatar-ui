import { h, Component } from 'preact';
import { hexToRgb, hexToRgba } from '../util/color';

const withCSS = (WrappedComponent, css) => {
  class WithCSS extends Component {
    componentWillMount() {
      const options = this.context.options || this.props.options;
      const { theme, colors, className, size } = options;
      this.$style = document.createElement('style');
      document.head.insertBefore(this.$style, document.head.firstChild);

      const primaryColor = hexToRgb(colors.base);
      const secondaryColor = hexToRgb(colors.accent);
      const tertiaryColor = hexToRgb(colors.emphasis);
      const settings = {
        className, size, primaryColor, secondaryColor, tertiaryColor,
      };
      const rules = (
        css(settings, this.props)
          .split(/\}\n[\s]*\./g)
          .filter((r) => !!r)
          .map((r) => r.trim())
          .map((r, i, arr) => {
            let newR = r;
            if (r[0] !== '.') {
              newR = `.${newR}`;
            }
            if (r[r.length - 1] !== '}') {
              newR = `${newR}}`;
            }
            return newR;
          })
      );
      rules.forEach((rule, i) => {
        this.$style.sheet.insertRule(rule, i);
      });
    }
    componentWillUnmount() {
      this.$style.parentNode.removeChild(this.$style);
    }
    render() {
      return <WrappedComponent {...this.props}  />
    }
  }
  return WithCSS;
}

export default withCSS;