import { rgba } from '../../util/color';

export default ({ className, size, primaryColor, secondaryColor, tertiaryColor }, {}) => (`
  .${className}-actionBar {
    padding: 10px;
    font-size: 0;
  }
  .${className}-actionBar-list {
    display: inline-block;
    list-style-type: none;
    margin: 0;
    padding-left: 0;
  }
  .${className}-actionBar-item {
    display: inline-block;
  }
  .${className}-actionBar-item:not(:last-child) {
    margin-right: 5px;
  }
  .${className}-actionBar-btn {
    position: relative;
    width: 32px;
    height: 32px;
    border-radius: 3px;
    background-color: ${rgba(secondaryColor, .5)};
    color: ${rgba(primaryColor)};
    cursor: pointer;
  }
  .${className}-actionBar-item.is-selected .${className}-actionBar-btn {
    background-color: ${rgba(secondaryColor)};
  }
  .${className}-actionBar-item.is-emphasized .${className}-actionBar-btn {
    background-color: ${rgba(tertiaryColor)};
  }
  .${className}-actionBar-btn svg {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: block;
    width: 18px;
    height: 18px;
  }
`);