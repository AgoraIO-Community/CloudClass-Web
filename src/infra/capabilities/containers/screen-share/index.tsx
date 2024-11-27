import { useStore } from '@classroom/infra/hooks/ui-store';
import { EduClassroomConfig, EduRoomTypeEnum, EduStream } from 'agora-edu-core';
import { AGRenderMode } from 'agora-rte-sdk';
import classnames from 'classnames';
import { observer } from 'mobx-react';
import React, { FC, useEffect, useRef, useState } from 'react';
import { SvgIconEnum, SvgImg } from '@classroom/ui-kit';
import { useI18n } from 'agora-common-libs';
import './index.css';
import { ComponentLevelRules } from '../../config';

const LocalScreenShare = observer(() => {
  const ref = useRef<HTMLDivElement | null>(null);
  const {
    
    streamUIStore: {setupLocalScreenShare },
  } = useStore();
  useEffect(() => {
    if (ref.current) {
      setupLocalScreenShare(ref.current)
    }
  }, [ref.current]);
  return (
    <div style={{ width: '100%', height: '100%'}}
      ref={ref}>
    </div>
  )
})

const ScreenShareLocalTrackPlayer = observer(() => {
  const transI18n = useI18n();
  const {
    
    streamUIStore: { stopScreenShareCapture, localScreenShareOff, setupLocalScreenShare },
  } = useStore();

  const [icon, setIcon] = useState(SvgIconEnum.SHARE_DEFAULT);
  const isBigClass = EduClassroomConfig.shared.sessionInfo.roomType === EduRoomTypeEnum.RoomBigClass

  return localScreenShareOff ? null : (
    <>
      <div className='stop-button_wrap'>
        <button
          className="stop-button"
          onClick={stopScreenShareCapture}
          onMouseEnter={() => setIcon(SvgIconEnum.SHARE_HOVER)}
          onMouseLeave={() => setIcon(SvgIconEnum.SHARE_DEFAULT)}>
          <SvgImg type={icon} style={{ display: 'flex', marginRight: 2 }} />
          <span>{transI18n('scaffold.stop_screen_share')}</span>
        </button>
      </div>
      {isBigClass ? <LocalScreenShare/>: null}
    </>
  );
});

export const ScreenShareRemoteTrackPlayer = observer(
  ({ style, stream, className }: { style?: any; stream: EduStream; className?: string }) => {
    const { streamUIStore } = useStore();
    const { setupRemoteVideo } = streamUIStore;

    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      if (ref.current) {
        setupRemoteVideo(stream, ref.current, false, AGRenderMode.fit);
      }
    }, [ref.current, stream]);

    return (
      <div
        style={{ width: '100%', height: '100%', ...style }}
        className={className}
        ref={ref}></div>
    );
  },
);

export type ScreenShareContainerProps = {
  className?: string;
};

export const ScreenShareContainer = observer<FC<ScreenShareContainerProps>>(
  ({ className = '' }) => {
    const {
      boardUIStore: { boardAreaHeight },
      streamUIStore: { screenShareStream },
    } = useStore();

    const remotecls = classnames(
      'remote-screen-share-container',
      'fcr-absolute',
      'fcr-bottom-0',
      className,
    );

    const localcls = classnames('local-screen-share-container', className);
    return screenShareStream ? (
      <React.Fragment>
        {screenShareStream?.isLocal ? (
          <div
            className={localcls}
            style={{
              top: `calc(100% - ${boardAreaHeight}px)`,
              zIndex: ComponentLevelRules.ScreenShare,
            }}>
            <ScreenShareLocalTrackPlayer />
          </div>
        ) : screenShareStream && !screenShareStream.isLocal ? (
          <div className={remotecls} style={{ height: boardAreaHeight }}>
            <ScreenShareRemoteTrackPlayer stream={screenShareStream} />
          </div>
        ) : null}
      </React.Fragment>
    ) : null;
  },
);
