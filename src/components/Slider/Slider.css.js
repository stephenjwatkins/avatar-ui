import { rgba } from '../../util/color';

export default ({ className, size, primaryColor, secondaryColor }, {}) => (`
  .${className}-slider {
    position: relative;
    width: 100%;
    height: 20px;
    cursor: default;
  }
  .${className}-slider-wrap {
    position: relative;
    margin: 0 auto;
    width: calc(100% - 20px);
    height: 20px;
    pointer-events: none;
  }
  .${className}-slider-handle {
    position: absolute;
    top: 0;
    left: 0;
    width: 20px;
    height: 20px;
    pointer-events: none;
    cursor: move;
    background-color: ${rgba(primaryColor)};
    border-radius: 100%;
    box-shadow: 0 1px 3px ${rgba(secondaryColor, .5)};
  }
  .${className}-slider-bar {
    position: absolute;
    top: 50%;
    margin-top: -2px;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background-color: ${rgba(primaryColor, .5)};
    box-shadow: 0 1px 4px ${rgba(secondaryColor, .2)};
  }
`);