import { rgba } from '../../util/color';

export default ({ className, size, primaryColor, secondaryColor }, {}) => (`
  .${className}-step2-actionBox {
    position: relative;
    width: ${size}px;
    height: ${size}px;
    text-align: center;
    cursor: move;
    border: 2px solid ${rgba(primaryColor)};
  }
  .${className}-step2-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
  .${className}-step2-frame {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: 10px solid ${rgba(secondaryColor, .5)};
  }
  .${className}-step2-slider {
    position: absolute;
    bottom: 22px;
    left: 22px;
    right: 22px;
    opacity: 0;
    transition: opacity .2s ease-in-out;
  }
  .${className}:hover .${className}-primaryBox:not(.is-dragging) .${className}-step2-slider {
    opacity: 1;
  }
`);