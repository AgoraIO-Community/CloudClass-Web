import React, { EventHandler, FC, SyntheticEvent, useEffect, useRef } from 'react';
import classnames from 'classnames';
import { BaseProps } from '~ui-kit/components/interface/base-props';
import './index.css';

type ButtonType = 'primary' | 'secondary' | 'ghost' | 'danger';

function createRipple(container: HTMLDivElement, y: number, x: number, type: ButtonType) {
  const circleElement = document.createElement('div');
  circleElement.className = 'ripple-circle';
  circleElement.style.top = y + 'px';
  circleElement.style.left = x + 'px';
  circleElement.style.background = type === 'primary' ? 'rgba(38, 99, 208, 1)' : '#fff';
  container.appendChild(circleElement);
  setTimeout(() => circleElement.remove(), 900);
}
export interface ButtonProps extends BaseProps {
  type?: ButtonType;
  size?: 'xs' | 'sm' | 'lg';
  disabled?: boolean;
  action?: string;
  animate?: boolean;
  onClick?: EventHandler<SyntheticEvent<HTMLButtonElement>>;
}

export const Button: FC<ButtonProps> = ({
  type = 'primary',
  size = 'sm',
  disabled,
  children,
  className,
  action,
  animate = true,
  ...restProps
}) => {
  const cls = classnames({
    [`btn btn-${size} btn-${type}`]: 1,
    [`${className}`]: !!className,
  });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const rippleRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const buttonElement = buttonRef.current;
    const rippleElement = rippleRef.current;
    const mousedownFn = (e: MouseEvent) => {
      if (e.target && rippleElement) {
        createRipple(
          rippleElement,
          e.pageY - (e.target as HTMLElement).getBoundingClientRect().top,
          e.pageX - (e.target as HTMLElement).getBoundingClientRect().left,
          type,
        );
      }
    };
    if (animate && buttonElement && rippleElement) {
      buttonElement.addEventListener('mousedown', mousedownFn);
    }
    return () => {
      if (animate && buttonElement && rippleElement) {
        buttonElement.removeEventListener('mousedown', mousedownFn);
      }
    };
  }, []);
  return (
    <button ref={buttonRef} className={cls} disabled={disabled} {...restProps}>
      {animate ? <div className="ripple" ref={rippleRef}></div> : null}
      <span style={{ position: 'relative', zIndex: 1 }}>{children}</span>
    </button>
  );
};
