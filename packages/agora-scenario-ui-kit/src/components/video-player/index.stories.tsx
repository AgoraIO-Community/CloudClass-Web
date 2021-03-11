import React, { FC } from 'react';
import { Meta } from '@storybook/react';
import { VideoPlayer, VideoPlayerProps } from '~components/video-player';

const meta: Meta = {
  title: 'Components/VideoPlayer',
  component: VideoPlayer,
  args: {
    username: 'Lily True',
    stars: 5,
    micEnabled: true,
    whiteboardGranted: true,
  }
};

export const Docs: FC<VideoPlayerProps> = ({ children, ...restProps }) => {
  return <VideoPlayer {...restProps}>{children}</VideoPlayer>;
};

export default meta;
