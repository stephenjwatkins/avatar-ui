import { rgba } from '../../util/color';

export default ({ className, size, primaryColor, secondaryColor }, {}) => (`
  .${className}-step1-actionBox {
    position: relative;
    width: ${size}px;
    height: ${size}px;
    text-align: center;
    cursor: pointer;
    background-color: ${rgba(primaryColor)};
    border: 2px dashed ${rgba(secondaryColor, 1)};
  }
  .${className}-step1-actionBox-content {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100%;
    padding: 0 10px;
    transform: translate(-50%, -50%);
    display: block;
  }
  .${className}-step1-actionBox-content-picWrap {
    display: ${size > 160 ? 'block' : 'none'};
    margin-bottom: ${size / 12}px;
  }
  .${className}-step1-actionBox-content-pic {
    display: inline-block;
    color: ${rgba(secondaryColor)};
  }
  .${className}-step1-actionBox-content-pic svg {
    display: block;
    width: ${size / 3.75}px;
    height: ${size / 3.75}px;
  }
  .${className}-step1-actionBox-content-choose {
    display: inline-block;
    padding-bottom: 4px;
    border-bottom: 2px solid ${rgba(secondaryColor)};
    font-weight: bold;
    color: ${rgba(secondaryColor)};
  }
  .${className}-step1-actionBox-content-drag {
    margin-top: 10px;
    color: ${rgba(secondaryColor, .5)};
  }
  .${className}-step1-actionBox-file-chooser {
    position: absolute;
    top: 0;
    left: 0;
    display: block;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
`);