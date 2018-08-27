import { rgba } from '../../util/color';

export default ({ className, size, primaryColor, secondaryColor }, {}) => (`
  .${className}-step3 {
    position: relative;
    width: ${size}px;
    height: ${size}px;
  }
  .${className}-step3-uploadBar {
    position: absolute;
    left: 0;
    top: 0;
    height: ${size}px;
    background-color: ${rgba(secondaryColor, .75)};
  }
  .${className}-step3-uploadText {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 100%;
    font-size: 100%;
    font-weight: bold;
    letter-spacing: 4px;
    color: ${rgba(primaryColor)};
    text-shadow: 0 1px 4px ${rgba(secondaryColor, .5)};
    text-align: center;
    text-transform: uppercase;
  }
`);