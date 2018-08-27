import { rgba } from '../../util/color';

export default ({ className, size, primaryColor, secondaryColor }, {}) => (`
  .${className}-progress {
    padding: 10px;
    text-align: center;
    border-top: 2px solid ${rgba(secondaryColor, .1)};
  }
  .${className}-progressList {
    list-style-type: none;
    margin: 0;
    font-size: 0;
    padding-left: 0;
  }
  .${className}-progressList-item {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 100%;
    background-color: ${rgba(secondaryColor, .25)};
  }
  .${className}-progressList-item:not(:last-child) {
    margin-right: 4px;
  }
  .${className}-progressList-item.is-selected {
    background-color: ${rgba(secondaryColor)};
  }
`);