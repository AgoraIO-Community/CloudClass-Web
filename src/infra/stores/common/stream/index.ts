import {
  AGError,
  AgoraRteMediaSourceState,
  AgoraRteMediaPublishState,
  AgoraRteAudioSourceType,
  AGRenderMode,
  bound,
} from 'agora-rte-sdk';
import {
  action,
  computed,
  IReactionDisposer,
  Lambda,
  observable,
  reaction,
  runInAction,
} from 'mobx';
import { InteractionStateColors } from '@classroom/ui-kit/utilities/state-color';
import { computedFn } from 'mobx-utils';
import { EduUIStoreBase } from '../base';
import { CameraPlaceholderType, EduStreamUI, StreamBounds } from './struct';
import { EduStreamTool, EduStreamToolCategory } from './tool';
import { v4 as uuidv4 } from 'uuid';
import {
  AgoraEduClassroomEvent,
  AGServiceErrorCode,
  ClassroomState,
  EduClassroomConfig,
  EduEventCenter,
  EduRoleTypeEnum,
  EduRoomTypeEnum,
  EduRteEngineConfig,
  EduRteRuntimePlatform,
  EduStream,
} from 'agora-edu-core';
import { interactionThrottleHandler } from '@classroom/infra/utils/interaction';
import { SvgIconEnum } from '@classroom/ui-kit';
import { transI18n } from 'agora-common-libs';
import { ShareStreamStateKeeper } from './state-keeper';

export enum StreamIconColor {
  active = '#357bf6',
  deactive = '#bdbdca',
  activeWarn = '#f04c36',
}

export class StreamUIStore extends EduUIStoreBase {
  protected _disposers: (IReactionDisposer | Lambda)[] = [];

  /**
   * 视频窗位置信息
   */
  /** @en
   * video stream bounds
   */
  @observable
  streamsBounds: Map<string, StreamBounds> = new Map();

  shareScreenStateKeeperMap: Map<string, ShareStreamStateKeeper> = new Map();

  @observable
  settingsOpened = false;

  @computed
  get screenShareStateAccessor() {
    return {
      trackState: this.classroomStore.mediaStore.localScreenShareTrackState,
      classroomState: this.classroomStore.connectionStore.classroomState,
    };
  }
  onInstall() {
    //this reaction is responsible to update screenshare track state when approporiate
    this._disposers.push(
      reaction(
        () => this.screenShareStateAccessor,
        (value) => {
          const { trackState, classroomState } = value;
          if (classroomState === ClassroomState.Connected) {
            //only set state when classroom is connected, the state will also be refreshed when classroom state become connected
            this.shareScreenStateKeeperMap
              .get(this.classroomStore.connectionStore.sceneId)
              ?.setShareScreenState(trackState);
          }
        },
      ),
    );
    this._disposers.push(
      computed(() => this.classroomStore.connectionStore.scene).observe(
        ({ newValue, oldValue }) => {
          if (oldValue) {
            this.shareScreenStateKeeperMap.get(oldValue.sceneId)?.stop();
          }
          if (newValue) {
            const stateKeeper = new ShareStreamStateKeeper(
              async (targetState: AgoraRteMediaSourceState) => {
                if (targetState === AgoraRteMediaSourceState.started) {
                  const isElectron = EduRteEngineConfig.platform === EduRteRuntimePlatform.Electron;
                  const enableAudio =
                    this.classroomStore.mediaStore.localScreenShareAudioTrackState ===
                    AgoraRteMediaSourceState.started;
                  //electron声卡采集合并到本地音频流,所以electron下屏幕共享流的audioPublishState设为Unpublished
                  const audioPublishState = !isElectron
                    ? enableAudio
                      ? AgoraRteMediaPublishState.Published
                      : AgoraRteMediaPublishState.Unpublished
                    : AgoraRteMediaPublishState.Unpublished;
                  const { rtcToken, streamUuid }: { rtcToken: string; streamUuid: string } =
                    await this.classroomStore.streamStore.publishScreenShare(newValue, {
                      audioState: audioPublishState,
                      audioSourceState:
                        this.classroomStore.mediaStore.localScreenShareAudioTrackState,
                      audioSourceType: AgoraRteAudioSourceType.Loopback,
                    });
                  this.classroomStore.streamStore.initializeScreenShareStream(
                    newValue,
                    streamUuid,
                    rtcToken,
                  );
                } else if (
                  targetState === AgoraRteMediaSourceState.stopped ||
                  targetState === AgoraRteMediaSourceState.error
                ) {
                  await this.classroomStore.streamStore.unpublishScreenShare(newValue);
                  this.classroomStore.streamStore.destroyScreenShareStream(newValue);
                }
              },
            );
            this.shareScreenStateKeeperMap.set(newValue.sceneId, stateKeeper);
          }
        },
      ),
    );

    this._disposers.push(
      reaction(
        () => ({
          uuids: this.getters.windowStreamUserUuids,
          pretestOpened: this.settingsOpened,
        }),
        () => {
          this.allUIStreams.forEach((stream) => {
            this._setRenderAt(stream);
          });
        },
      ),
    );

    EduEventCenter.shared.onClassroomEvents(this._handleRewardsChange);
  }
  @bound
  _handleRewardsChange(e: AgoraEduClassroomEvent, params: unknown) {
    if (
      e === AgoraEduClassroomEvent.RewardReceived ||
      e === AgoraEduClassroomEvent.BatchRewardReceived
    ) {
      const users = params as { userUuid: string; userName: string }[];
      const anims: { id: string; userUuid: string }[] = [];
      users.forEach((user) => {
        const onPodium = this.classroomStore.roomStore.acceptedList.some(
          ({ userUuid: thisUuid }) => thisUuid === user.userUuid,
        );
        const haveAnimation =
          EduClassroomConfig.shared.sessionInfo.roomType === EduRoomTypeEnum.Room1v1Class ||
          onPodium;
        haveAnimation && anims.push({ id: uuidv4(), userUuid: user.userUuid });
      });
      if (anims.length > 0) {
        runInAction(() => {
          this.awardAnims = this.awardAnims.concat(anims);
        });
      }
    }
  }
  @bound
  protected _setRenderAt(stream: EduStreamUI) {
    const streamWindowUserUuids = this.getters.windowStreamUserUuids;
    if (this.settingsOpened && stream.stream.isLocal) {
      stream.setRenderAt('Setting');
    } else if (streamWindowUserUuids.includes(stream.fromUser.userUuid)) {
      stream.setRenderAt('Window');
    } else {
      stream.setRenderAt('Bar');
    }
  }

  /**
   * 奖励信息
   */
  @observable awardAnims: { id: string; userUuid: string }[] = [];

  /**
   * 分离窗口视频流
   * @returns
   */
  @computed get allUIStreams(): Map<string, EduStreamUI> {
    const uiStreams = new Map<string, EduStreamUI>();

    [this.teacherCameraStream, ...this.studentCameraStreams].forEach((streamUI) => {
      if (streamUI) {
        uiStreams.set(streamUI.stream.streamUuid, streamUI);
      }
    });

    return uiStreams;
  }

  /**
   * 老师流信息（教室内只有一个老师时使用，如果有一个以上老师请使用 teacherStreams）
   * @returns
   */
  @computed get teacherCameraStream(): EduStreamUI | undefined {
    let stream = undefined;
    const { teacherCameraStream } = this.getters;

    if (teacherCameraStream) {
      stream = new EduStreamUI(teacherCameraStream);
      this._setRenderAt(stream);
    }

    return stream;
  }

  /**
   * 学生流信息（教室内只有一个学生时使用，如果有一个以上老师请使用 studentStreams）
   * @returns
   */
  @computed get studentCameraStream(): EduStreamUI | undefined {
    let stream = undefined;
    const { studentCameraStreams } = this.getters;

    if (studentCameraStreams.length) {
      stream = new EduStreamUI(studentCameraStreams[0]);
      this._setRenderAt(stream);
    }

    return stream;
  }

  /**
   * 学生流信息（教室内只有一个学生时使用，如果有一个以上老师请使用 studentStreams）
   * @returns
   */
  @computed get studentCameraStreams(): EduStreamUI[] {
    const { studentCameraStreams } = this.getters;

    const streams = studentCameraStreams.map((stream) => {
      const streamUI = new EduStreamUI(stream);
      this._setRenderAt(streamUI);
      return streamUI;
    });

    return streams;
  }

  /**
   * 屏幕共享流
   * @returns
   */
  @computed get screenShareStream(): EduStream | undefined {
    const streamUuid = this.classroomStore.roomStore.screenShareStreamUuid as string;
    const stream = this.classroomStore.streamStore.streamByStreamUuid.get(streamUuid);

    return stream;
  }

  /**
   * 获取远端流音量
   * @returns
   */
  remoteStreamVolume = computedFn((stream: EduStreamUI) => {
    const volume = this.classroomStore.streamStore.streamVolumes.get(stream.stream.streamUuid) || 0;
    return volume * 100;
  });

  /**
   * 本地音量
   * @returns
   */
  @computed get localVolume(): number {
    return this.classroomStore.mediaStore.localMicAudioVolume * 100;
  }

  /**
   * 本地摄像头设备状态
   * @returns
   */
  @computed get localCameraTrackState(): AgoraRteMediaSourceState {
    return this.classroomStore.mediaStore.localCameraTrackState;
  }

  /**
   * 本地麦克风设备状态
   * @returns
   */
  @computed get localMicTrackState(): AgoraRteMediaSourceState {
    return this.classroomStore.mediaStore.localMicTrackState;
  }

  /**
   * 本地屏幕共享状态
   * @returns
   */
  @computed get localScreenShareOff() {
    return (
      EduClassroomConfig.shared.sessionInfo.role !== EduRoleTypeEnum.student &&
      this.classroomStore.mediaStore.localScreenShareTrackState !== AgoraRteMediaSourceState.started
    );
  }

  /**
   * 本地摄像头设备是否关闭
   * @returns
   */
  @computed get localCameraOff() {
    return this.localCameraTrackState !== AgoraRteMediaSourceState.started;
  }

  /**
   * 本地麦克风设备是否关闭
   * @returns
   */
  @computed get localMicOff() {
    return this.localMicTrackState !== AgoraRteMediaSourceState.started;
  }

  /**
   * 镜像是否开启
   * @returns
   */
  @computed get isMirror() {
    return this.classroomStore.mediaStore.isMirror;
  }

  /**
   * 白板授权用户列表
   * @returns
   */
  @computed get whiteboardGrantUsers() {
    return this.boardApi.grantedUsers;
  }

  /**
   * 视频窗口显示的挂件信息
   * reward: 奖励信息
   * grant: 授权状态
   * @returns
   */
  get layerItems() {
    return ['reward', 'grant'];
  }

  /**
   * 远端流是否正在举手
   * @returns
   */
  isWaveArm = computedFn((stream: EduStreamUI): boolean => {
    return this.classroomStore.roomStore.waveArmList.some(
      (it) => it.userUuid === stream.fromUser.userUuid,
    );
  });

  /**
   * 远端流奖励信息
   * @returns
   */
  awards = computedFn((stream: EduStreamUI): number => {
    const reward = this.classroomStore.userStore.rewards.get(stream.fromUser.userUuid);
    return reward || 0;
  });

  /**
   * 远端流奖励动画列表
   * @returns
   */
  streamAwardAnims = computedFn((stream: EduStreamUI): { id: string; userUuid: string }[] => {
    return this.awardAnims.filter((anim) => anim.userUuid === stream.fromUser.userUuid);
  });

  /**
   * 本地视频窗摄像头
   * @returns
   */
  localCameraTool = computedFn((): EduStreamTool => {
    return new EduStreamTool(
      EduStreamToolCategory.camera,
      this.localCameraOff
        ? { icon: SvgIconEnum.CAMERA_DISABLED, color: InteractionStateColors.disabled }
        : { icon: SvgIconEnum.CAMERA_ENABLED, color: InteractionStateColors.allow },
      this.localCameraOff ? transI18n('Open Camera') : transI18n('Close Camera'),
      {
        //i can always control myself
        interactable: true,
        hoverIconType: {
          icon: SvgIconEnum.CAMERA_DISABLED,
          color: InteractionStateColors.disabled,
        },
        onClick: async () => {
          try {
            this.toggleLocalVideo();
          } catch (e) {
            this.shareUIStore.addGenericErrorDialog(e as AGError);
          }
        },
      },
    );
  });

  /**
   * 本地视频窗麦克风
   * @returns
   */
  localMicTool = computedFn((): EduStreamTool => {
    return new EduStreamTool(
      EduStreamToolCategory.microphone,
      this.localMicOff
        ? { icon: SvgIconEnum.MIC_DISABLED, color: InteractionStateColors.disabled }
        : { icon: SvgIconEnum.MIC_ENABLED, color: InteractionStateColors.allow },
      this.localMicOff ? transI18n('Open Microphone') : transI18n('Close Microphone'),
      {
        //host can control, or i can control myself
        interactable: true,
        hoverIconType: { icon: SvgIconEnum.MIC_DISABLED, color: InteractionStateColors.disabled },
        onClick: async () => {
          try {
            this.toggleLocalAudio();
          } catch (e) {
            this.shareUIStore.addGenericErrorDialog(e as AGError);
          }
        },
      },
    );
  });

  /**
   * 本地视频窗上下台
   * @returns
   */
  localPodiumTool = computedFn((): EduStreamTool => {
    return new EduStreamTool(
      EduStreamToolCategory.podium_all,
      { icon: SvgIconEnum.ON_PODIUM, color: InteractionStateColors.half },
      transI18n('Clear Podiums'),
      {
        interactable: !!this.studentCameraStreams.length,
        hoverIconType: { icon: SvgIconEnum.ON_PODIUM, color: InteractionStateColors.allow },
        onClick: async () => {
          try {
            await this.classroomStore.handUpStore.offPodiumAll();
          } catch (e) {
            if (
              !AGError.isOf(
                e as Error,
                AGServiceErrorCode.SERV_PROCESS_CONFLICT,
                AGServiceErrorCode.SERV_ACCEPT_NOT_FOUND,
              )
            ) {
              this.shareUIStore.addGenericErrorDialog(e as AGError);
            }
          }
        },
      },
    );
  });

  /**
   * 远端视频窗摄像头
   * @returns
   */
  remoteCameraTool = computedFn((stream: EduStreamUI): EduStreamTool => {
    const videoMuted = stream.stream.videoState === AgoraRteMediaPublishState.Unpublished;
    const videoSourceStopped = stream.stream.videoSourceState === AgoraRteMediaSourceState.stopped;
    return new EduStreamTool(
      EduStreamToolCategory.camera,
      videoSourceStopped
        ? { icon: SvgIconEnum.CAMERA_DISABLED, color: InteractionStateColors.disabled }
        : videoMuted
        ? { icon: SvgIconEnum.CAMERA_DISABLED, color: InteractionStateColors.disallow }
        : { icon: SvgIconEnum.CAMERA_ENABLED, color: InteractionStateColors.allow },
      videoSourceStopped
        ? transI18n('Camera Not Available')
        : videoMuted
        ? transI18n('Open Camera')
        : transI18n('Close Camera'),
      {
        //can interact when source is not stopped
        interactable: !videoSourceStopped,
        hoverIconType: {
          icon: SvgIconEnum.CAMERA_DISABLED,
          color: InteractionStateColors.disallow,
        },
        onClick: () => {
          this.classroomStore.streamStore
            .updateRemotePublishState(stream.fromUser.userUuid, stream.stream.streamUuid, {
              videoState: videoMuted
                ? AgoraRteMediaPublishState.Published
                : AgoraRteMediaPublishState.Unpublished,
            })
            .catch((e) => this.shareUIStore.addGenericErrorDialog(e as AGError));
        },
      },
    );
  });

  /**
   * 远端视频窗麦克风
   * @returns
   */
  remoteMicTool = computedFn((stream: EduStreamUI): EduStreamTool => {
    const audioMuted = stream.stream.audioState === AgoraRteMediaPublishState.Unpublished;
    const audioSourceStopped = stream.stream.audioSourceState === AgoraRteMediaSourceState.stopped;
    return new EduStreamTool(
      EduStreamToolCategory.microphone,
      audioSourceStopped
        ? { icon: SvgIconEnum.MIC_DISABLED, color: InteractionStateColors.disabled }
        : audioMuted
        ? { icon: SvgIconEnum.MIC_DISABLED, color: InteractionStateColors.disallow }
        : { icon: SvgIconEnum.MIC_ENABLED, color: InteractionStateColors.allow },
      audioSourceStopped
        ? transI18n('Microphone Not Available')
        : audioMuted
        ? transI18n('Open Microphone')
        : transI18n('Close Microphone'),
      {
        //can interact when source is not stopped
        interactable: !audioSourceStopped,
        hoverIconType: { icon: SvgIconEnum.MIC_DISABLED, color: InteractionStateColors.disallow },
        onClick: async () => {
          this.classroomStore.streamStore
            .updateRemotePublishState(stream.fromUser.userUuid, stream.stream.streamUuid, {
              audioState: audioMuted
                ? AgoraRteMediaPublishState.Published
                : AgoraRteMediaPublishState.Unpublished,
            })
            .catch((e) => this.shareUIStore.addGenericErrorDialog(e as AGError));
        },
      },
    );
  });

  /**
   * 远端视频窗上下台
   * @returns
   */
  remotePodiumTool = computedFn((stream: EduStreamUI): EduStreamTool => {
    return new EduStreamTool(
      EduStreamToolCategory.podium,
      { icon: SvgIconEnum.ON_PODIUM, color: InteractionStateColors.half },
      transI18n('Clear Podium'),
      {
        interactable: true,
        hoverIconType: { icon: SvgIconEnum.ON_PODIUM, color: InteractionStateColors.allow },
        onClick: async () => {
          try {
            await this.classroomStore.handUpStore.offPodium(stream.fromUser.userUuid);
          } catch (e) {
            if (
              !AGError.isOf(
                e as Error,
                AGServiceErrorCode.SERV_PROCESS_CONFLICT,
                AGServiceErrorCode.SERV_ACCEPT_NOT_FOUND,
              )
            ) {
              this.shareUIStore.addGenericErrorDialog(e as AGError);
            }
          }
        },
      },
    );
  });

  /**
   * 远端视频窗白板授权
   * @returns
   */
  remoteWhiteboardTool = computedFn((stream: EduStreamUI): EduStreamTool => {
    const whiteboardAuthorized = this.whiteboardGrantUsers.has(stream.fromUser.userUuid);
    const whiteboardReady = this.boardApi.connected;
    return new EduStreamTool(
      EduStreamToolCategory.whiteboard,
      whiteboardReady
        ? whiteboardAuthorized
          ? { icon: SvgIconEnum.BOARD_NOT_GRANTED, color: InteractionStateColors.allow }
          : { icon: SvgIconEnum.BOARD_NOT_GRANTED, color: InteractionStateColors.half }
        : { icon: SvgIconEnum.BOARD_NOT_GRANTED, color: InteractionStateColors.disabled },
      whiteboardReady
        ? whiteboardAuthorized
          ? transI18n('Close Whiteboard')
          : transI18n('Open Whiteboard')
        : transI18n('Whiteboard Not Available'),
      {
        interactable: whiteboardReady,
        hoverIconType: {
          icon: SvgIconEnum.BOARD_NOT_GRANTED,
          color: InteractionStateColors.allow,
        },
        onClick: () => {
          this.boardApi.grantPrivilege(stream.fromUser.userUuid, !whiteboardAuthorized);
        },
      },
    );
  });

  /**
   * 远端视频窗奖励
   * @returns
   */
  remoteRewardTool = computedFn((stream: EduStreamUI): EduStreamTool => {
    return new EduStreamTool(
      EduStreamToolCategory.star,
      { icon: SvgIconEnum.REWARD, color: InteractionStateColors.half },
      transI18n('Star'),
      {
        interactable: true,
        hoverIconType: { icon: SvgIconEnum.REWARD, color: InteractionStateColors.allow },
        onClick: interactionThrottleHandler(
          () => {
            this.classroomStore.roomStore
              .sendRewards([{ userUuid: stream.fromUser.userUuid, changeReward: 1 }])
              .catch((e) => this.shareUIStore.addGenericErrorDialog(e as AGError));
          },
          (message) => this.shareUIStore.addToast(message, 'warning'),
        ),
      },
    );
  });

  /**
   * 本地视频窗工具列表
   * @returns
   */
  @computed get localStreamTools(): EduStreamTool[] {
    const tools: EduStreamTool[] = [];
    // tools = tools.concat([this.localCameraTool(), this.localMicTool()]);

    return tools;
  }

  /**
   * 远端视频窗工具列表
   * @returns
   */
  remoteStreamTools = computedFn((stream: EduStreamUI): EduStreamTool[] => {
    const iAmHost =
      EduClassroomConfig.shared.sessionInfo.role === EduRoleTypeEnum.teacher ||
      EduClassroomConfig.shared.sessionInfo.role === EduRoleTypeEnum.assistant;
    let tools: EduStreamTool[] = [];
    if (iAmHost) {
      tools = tools.concat([this.remoteCameraTool(stream), this.remoteMicTool(stream)]);
      if (stream.role === EduRoleTypeEnum.student) {
        tools = tools.concat([this.remoteWhiteboardTool(stream), this.remoteRewardTool(stream)]);
      }
    }
    return tools;
  });

  /**
   * 本地音频图标
   * @returns
   */
  @computed get localMicIconType() {
    return this.localMicOff ? 'microphone-off' : 'microphone-on';
  }

  /**
   * 本地视频占位符
   * @returns
   */
  cameraPlaceholder = computedFn((stream: EduStreamUI): CameraPlaceholderType => {
    const isLocal =
      stream.stream.streamUuid === this.classroomStore.streamStore.localCameraStreamUuid;

    const videoSourceState = isLocal
      ? this.classroomStore.mediaStore.localCameraTrackState
      : stream.stream.videoSourceState;

    let placeholder = CameraPlaceholderType.none;

    const deviceDisabled = videoSourceState === AgoraRteMediaSourceState.stopped;

    if (deviceDisabled) {
      return CameraPlaceholderType.disabled;
    }

    if (
      stream.stream.videoState === AgoraRteMediaPublishState.Published &&
      videoSourceState === AgoraRteMediaSourceState.started
    ) {
      placeholder = CameraPlaceholderType.none;
    } else {
      placeholder = CameraPlaceholderType.muted;
    }
    return placeholder;
  });

  /**
   * 视频窗工具栏定位
   * @returns
   */
  get toolbarPlacement(): 'left' | 'bottom' {
    return 'bottom';
  }

  /**
   * 视频窗工具栏定位
   * @returns
   */
  get toolbarOffset(): number[] {
    return [0, 0];
  }

  /**
   * 大窗视频窗工具栏定位
   * @returns
   */
  get fullScreenToolbarPlacement(): 'left' | 'bottom' {
    return 'bottom';
  }

  /**
   * 大窗视频窗工具栏定位
   * @returns
   */
  get fullScreenToolbarOffset(): number[] {
    return [0, -48];
  }
  /**
   * 移除奖励动画
   * @param id
   */
  @action.bound
  removeAward(id: string) {
    this.awardAnims = this.awardAnims.filter((anim) => anim.id !== id);
  }

  /**
   * 切换本地摄像头设备开关状态
   */
  @bound
  toggleLocalVideo() {
    if (this.localCameraOff) {
      this.classroomStore.mediaStore.enableLocalVideo(true);
    } else {
      this.classroomStore.mediaStore.enableLocalVideo(false);
    }
  }

  /**
   * 切换本地麦克风设备开关状态
   */
  @bound
  toggleLocalAudio() {
    if (this.localMicOff) {
      this.classroomStore.mediaStore.enableLocalAudio(true);
    } else {
      this.classroomStore.mediaStore.enableLocalAudio(false);
    }
  }

  /**
   * 渲染本地 Stream 视频到 DOM
   * @param stream
   * @param dom
   * @param mirror
   * @returns
   */
  @bound
  setupLocalVideo(dom: HTMLElement, mirror = false, renderMode?: AGRenderMode) {
    return this.classroomStore.mediaStore.setupLocalVideo(dom, mirror, renderMode);
  }

  /**
   * 渲染远端 Stream 视频到 DOM
   * @param stream
   * @param dom
   * @param mirror
   * @param renderMode
   * @returns
   */
  @bound
  setupRemoteVideo(
    stream: EduStream,
    dom: HTMLElement,
    mirror: boolean,
    renderMode?: AGRenderMode,
  ) {
    return this.classroomStore.streamStore.setupRemoteVideo(stream, dom, mirror, renderMode);
  }

  /**
   * 渲染本地屏幕共享到 DOM
   * @param dom
   */
  @bound
  setupLocalScreenShare(dom: HTMLElement) {
    this.classroomStore.mediaStore.setupLocalScreenShare(dom);
  }

  /**
   * 停止屏幕视频采集
   * @returns
   */
  @bound
  stopScreenShareCapture() {
    return this.classroomStore.mediaStore.stopScreenShareCapture();
  }

  @action.bound
  setStreamBoundsByStreamUuid(streamUuid: string, bounds: StreamBounds) {
    this.streamsBounds.set(streamUuid, bounds);
  }

  @action.bound
  removeStreamBoundsByStreamUuid(streamUuid: string) {
    this.streamsBounds.delete(streamUuid);
  }

  @action.bound
  setSettingsOpened(opened: boolean) {
    this.settingsOpened = opened;
  }

  onDestroy() {
    EduEventCenter.shared.offClassroomEvents(this._handleRewardsChange);
    this._disposers.forEach((d) => d());
    this._disposers = [];
  }
}
