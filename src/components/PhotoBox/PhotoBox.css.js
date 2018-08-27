import { rgba } from '../../util/color';

export default ({ className, size, primaryColor, secondaryColor }, {}) => (`
  .${className}Container {
    display: inline-block;
    position: absolute;
    opacity: 0;
    font-family: inherit;
    background-color: ${rgba(primaryColor)};
    border: 1px solid ${rgba(secondaryColor, .25)};
    border-radius: 3px;
    box-shadow: 0 2px 20px rgba(0,0,0, .15);
    transition: opacity .2s ease-in-out;
    -webkit-user-select: none;
       -moz-user-select: none;
            user-select: none;
  }
  .${className} {
    position: relative;
  }
  .${className}-anchor {
    display: inline-block;
    position: absolute;
    bottom: 100%;
    bottom: calc(100% + 1px);
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-color: transparent;
    border-bottom-color: ${rgba(secondaryColor, .25)};
    border-style: solid;
    border-width: 0 6px 6px 6px;
  }
  .${className}-primaryBox {
    position: relative;
    padding: 10px;
    background-color: ${rgba(secondaryColor, .1)};
  }
`);