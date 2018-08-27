import { h, cloneElement } from 'preact';
import Icon from '../Icon';
import withCSS from '../withCSS';
import { classnames } from '../../util/classnames';
import css from './PhotoBoxActionBar.css.js';

export const PhotoBoxActionBarItem = (
  ({ icon, isSelected, onPress, isEmphasized }, { options }) => {
    const { className } = options;
    return (
      <li class={classnames({
        [`${className}-actionBar-item`]: true,
        'is-selected': isSelected,
        'is-emphasized': isEmphasized,
      })}>
        <div class={`${className}-actionBar-btn`} onClick={onPress}>
          <Icon name={icon} />
        </div>
      </li>
    );
  }
);

export const PhotoBoxActionBarList = ({ children }, { options }) => {
  const { className } = options;
  return (
    <ul class={`${className}-actionBar-list`}>
      {children}
    </ul>
  );
};

export const PhotoBoxActionBar = withCSS(({ children }, { options }) => {
  const { className } = options;
  return (
    <div class={`${className}-actionBar`}>
      {children}
    </div>
  );
}, css);
