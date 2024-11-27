import { FcrBoardShape, FcrBoardTool } from '@classroom/infra/protocol/type';
import { dataURIToFile } from '@classroom/infra/utils';
import { AgoraEduClassroomUIEvent, EduEventUICenter } from '@classroom/infra/utils/event-center';
import { listenChannelMessage, sendToMainProcess } from '@classroom/infra/utils/ipc';
import { ChannelType, IPCMessageType } from '@classroom/infra/utils/ipc-channels';

import {
  AGEduErrorCode,
  CustomBtoa,
  EduClassroomConfig,
  EduErrorCenter,
  EduRoleTypeEnum,
  EduRoomTypeEnum,
  EduRteEngineConfig,
} from 'agora-edu-core';
import {
  AGError,
  AgoraRteEngineConfig,
  AgoraRteMediaSourceState,
  AgoraRteRuntimePlatform,
  AgoraRteVideoSourceType,
  AGScreenShareDevice,
  bound,
  Log,
} from 'agora-rte-sdk';
import isEqual from 'lodash/isEqual';
import { action, computed, observable, reaction, runInAction, toJS, when } from 'mobx';
import { EduUIStoreBase } from '../base';
import { DialogCategory } from '../share';
import { EduStreamUI } from '../stream/struct';
import { CabinetItem, CabinetItemEnum, ToolbarItem, ToolbarItemCategory } from './type';
import { rgbToHexColor } from '../../../utils/board-utils';
import { conversionOption, fileExt2ContentType } from '../cloud-drive/helper';
import { transI18n } from 'agora-common-libs';
import { LayoutMaskCode } from '../type';

@Log.attach({ proxyMethods: false })
export class ToolbarUIStore extends EduUIStoreBase {
  readonly defaultColors = [
    '#ffffff',
    '#9b9b9b',
    '#4a4a4a',
    '#000000',
    '#d0021b',
    '#f5a623',
    '#f8e71c',
    '#7ed321',
    '#9013fe',
    '#50e3c2',
    '#0073ff',
    '#ffc8e2',
  ];
  readonly defaultPens = [
    'pen',
    'square',
    'circle',
    'line',
    'pentagram',
    'rhombus',
    'arrow',
    'triangle',
  ];
  readonly paletteMap: Record<string, string> = {
    '#ffffff': '#E1E1EA',
  };

  readonly module: string = 'screenshot-toolbar';

  readonly allowedCabinetItems: string[] = [
    CabinetItemEnum.Whiteboard,
    CabinetItemEnum.ScreenShare,
    CabinetItemEnum.BreakoutRoom,
    CabinetItemEnum.Laser,
    CabinetItemEnum.VideoGallery,
  ];

  private _disposers: (() => void)[] = [];

  onInstall() {
    if (AgoraRteEngineConfig.platform === AgoraRteRuntimePlatform.Electron) {
      this._disposers.push(
        listenChannelMessage(ChannelType.Message, async (event, message) => {
          switch (message.type) {
            case IPCMessageType.SwitchScreenShareDevice:
              this.selectScreenShareDevice();
              break;
          }
        }),
      );
      this._disposers.push(
        listenChannelMessage(
          ChannelType.ShortCutCapture,
          (event, { type, payload }: { type: string; payload?: any }) => {
            if (
              type === IPCMessageType.ShortCutCaptureDone &&
              this.module === (payload.module as string)
            ) {
              this._pastToBoard(payload.dataURL);
            }
            if (type === IPCMessageType.ShortCutCaptureDenied) {
              this.shareUIStore.addToast(
                transI18n('toast2.screen_shot_permission_denied'),
                'error',
              );
            }
          },
        ),
      );
    }
    this._disposers.push(
      computed(() => this.classroomStore.streamStore.localShareStreamUuid).observe(
        ({ newValue, oldValue }) => {
          const { userUuid } = EduClassroomConfig.shared.sessionInfo;

          if (newValue && !oldValue) {
            this.classroomStore.widgetStore.setActive(
              `streamWindow-${newValue}`,
              {
                position: { xaxis: 1, yaxis: 1 },
                size: { width: 1, height: 1 },
                extra: {
                  userUuid,
                },
              },
              userUuid,
            );
          }
          if (!newValue && oldValue) {
            this.classroomStore.widgetStore.deleteWidget(`streamWindow-${oldValue}`);
          }
        },
      ),
    );

    this._disposers.push(
      reaction(
        () => this.boardApi.mounted,
        (mounted) => {
          runInAction(() => {
            if (mounted) {
              this._activeCabinetItems.add(CabinetItemEnum.Whiteboard);
            } else {
              this._activeCabinetItems.delete(CabinetItemEnum.Whiteboard);
            }
          });
        },
      ),
    );
    this._disposers.push(
      reaction(
        () => this.classroomStore.roomStore.isScreenSharing,
        (isScreenSharing) => {
          runInAction(() => {
            if (isScreenSharing) {
              this._activeCabinetItems.add(CabinetItemEnum.ScreenShare);
            } else {
              this._activeCabinetItems.delete(CabinetItemEnum.ScreenShare);
            }
          });
        },
      ),
    );
  }

  // observables
  @observable activeMap: Record<string, boolean> = {};
  @observable private _activeCabinetItems: Set<string> = new Set();

  //computed

  /**
   * 当前激活的工具
   * @returns
   */
  @computed
  get activeTool() {
    const tool = this._convertEduTools2UITools(
      this.boardApi.selectedTool,
      this.boardApi.selectedShape,
    );
    return tool;
  }

  /**
   * 当前激活的画笔类工具
   * @returns
   */
  @computed
  get selectedPenTool() {
    if (this.isPenToolActive) {
      return this.activeTool;
    }
    return 'pen';
  }

  /**
   * 画笔工具是否激活
   * @returns
   */
  @computed
  get isPenToolActive() {
    return this.activeTool && this.penTools.includes(this.activeTool);
  }

  /**
   * 选中的画笔颜色
   * @returns
   */
  @computed
  get currentColor() {
    const { r, g, b } = this.boardApi.strokeColor;
    return rgbToHexColor(r, g, b);
  }

  /**
   * 选中的画笔粗细
   * @returns
   */
  @computed
  get strokeWidth() {
    return this.boardApi.strokeWidth;
  }

  /**
   * 是否正在进行屏幕共享
   * @returns
   */
  @computed
  get isScreenSharing() {
    return this._activeCabinetItems.has(CabinetItemEnum.ScreenShare);
  }

  /**
   * 是否打开白板
   * @returns
   */
  @computed
  get isWhiteboardOpening() {
    return this._activeCabinetItems.has(CabinetItemEnum.Whiteboard);
  }

  //actions
  @action.bound
  handleBoradCleaner(id: string) {
    if (id === 'clear') {
      this.shareUIStore.addConfirmDialog(
        transI18n('toast.clear_whiteboard'),
        transI18n('toast.clear_whiteboard_confirm'),
        {
          onOK: () => {
            this.setTool(id);
          },
        },
      );
    } else {
      this.setTool(id);
    }
  }

  /**
   * 老师流信息列表
   * @returns
   */
  @computed get teacherStreams(): Set<EduStreamUI> {
    const streamSet = new Set<EduStreamUI>();
    const teacherList = this.classroomStore.userStore.teacherList;
    for (const teacher of teacherList.values()) {
      const streamUuids =
        this.classroomStore.streamStore.streamByUserUuid.get(teacher.userUuid) || new Set();
      for (const streamUuid of streamUuids) {
        const stream = this.classroomStore.streamStore.streamByStreamUuid.get(streamUuid);
        if (stream) {
          const uiStream = new EduStreamUI(stream);
          streamSet.add(uiStream);
        }
      }
    }
    return streamSet;
  }

  /**
   * 老师流信息（教室内只有一个老师时使用，如果有一个以上老师请使用 teacherStreams）
   * @returns
   */
  @computed get teacherCameraStream(): EduStreamUI | undefined {
    const streamSet = new Set<EduStreamUI>();
    const streams = this.teacherStreams;
    for (const stream of streams) {
      if (stream.stream.videoSourceType === AgoraRteVideoSourceType.Camera) {
        streamSet.add(stream);
      }
    }

    if (streamSet.size > 1) {
      return EduErrorCenter.shared.handleThrowableError(
        AGEduErrorCode.EDU_ERR_UNEXPECTED_TEACHER_STREAM_LENGTH,
        new Error(`unexpected stream size ${streams.size}`),
      );
    }
    return Array.from(streamSet)[0];
  }
  @action.bound
  startLocalScreenShare() {
    if (!this.classroomStore.mediaStore.hasScreenSharePermission()) {
      this.shareUIStore.addToast(transI18n('toast2.screen_permission_denied'), 'warning');
    }
    if (this.isScreenSharing) {
      this.classroomStore.mediaStore.stopScreenShareCapture();
    } else {
      if (this.classroomStore.mediaStore.isScreenDeviceEnumerateSupported()) {
        //electron开启屏幕选择
        this.selectScreenShareDevice();
      } else {
        //not supported, start directly
        //web不需要传入屏幕id和类型，置为undefined，开启分享声音
        this.classroomStore.mediaStore.startScreenShareCapture({ withAudio: true });
      }
    }
  }
  async selectScreenShareDevice() {
    let [displays, windows] = await Promise.all([
      this.classroomStore.mediaStore.getDisplayDevices(),
      this.classroomStore.mediaStore.getWindowDevices(),
    ]);

    const haveImage = ({ image }: AGScreenShareDevice) => !!image;

    displays = displays.filter(haveImage);
    windows = windows.filter(haveImage);

    displays = displays.map((d, idx) => {
      return {
        ...d,
        title: transI18n('screenshare.display', { reason: idx }),
        imagebase64: CustomBtoa(d.image),
      };
    });

    windows = windows
      .map((d) => {
        return {
          ...d,
          imagebase64: CustomBtoa(d.image),
        };
      })
      .filter((win) => !win.isCurrent);
    const collections = [...displays, ...windows];
    this.shareUIStore.addDialog(DialogCategory.ScreenPicker, {
      onOK: async (itemId: string, withAudio: boolean) => {
        const id = toJS(itemId);
        const item = collections.find((c) => {
          return isEqual(c.id, id);
        });
        if (item) {
          if (
            this.classroomStore.mediaStore.localScreenShareTrackState ===
            AgoraRteMediaSourceState.started
          ) {
            this.classroomStore.mediaStore.stopScreenShareCapture();
            await when(() => {
              return this.classroomStore.streamStore.shareStreamTokens.size === 0;
            });
          }
          setTimeout(() => {
            this.classroomStore.mediaStore.startScreenShareCapture({
              id: itemId,
              type: item.type,
              withAudio,
            });
            this.classroomStore.mediaStore.setCurrentScreenShareDevice(item);
          }, 0);
        }
      },
      desktopList: displays,
      windowList: windows,
    });
  }
  /**
   * 打开内建工具
   * @param id
   */
  @action.bound
  async openBuiltinCabinet(id: string) {
    debugger

    switch (id) {
      case CabinetItemEnum.ScreenShare:
        // 大班课才会出现屏幕共享冲突
        if(EduClassroomConfig.shared.sessionInfo.roomType === EduRoomTypeEnum.RoomBigClass){
          const localUserUuid = this.classroomStore.userStore.localUser?.userUuid;
          const screenShareUserUuid = this.classroomStore.roomStore.screenShareUserUuid;
  
          if (screenShareUserUuid && localUserUuid != this.classroomStore.roomStore.screenShareUserUuid ){
            // 有人共享，这个人不是自己
            this.shareUIStore.addToast(
              transI18n('toast2.no_permission_to_share_screen'),
              'error',
            );
            return;
          }
        }
        if (this.isScreenSharing) {
          this.classroomStore.mediaStore.stopScreenShareCapture();
          return;
        }
        this.startLocalScreenShare();
        break;
      case CabinetItemEnum.Laser:
        this.setTool(id);
        break;
      case CabinetItemEnum.Whiteboard:
        if (this.isWhiteboardOpening) {
          this.shareUIStore.addConfirmDialog(
            transI18n('toast.close_whiteboard'),
            transI18n('toast.close_whiteboard_confirm'),
            {
              onOK: () => {
                this.boardApi.disable();
                EduEventUICenter.shared.emitClassroomUIEvents(
                  AgoraEduClassroomUIEvent.toggleWhiteboard,
                  true,
                );
              },
            },
          );
        } else {
          this.boardApi.enable();
          EduEventUICenter.shared.emitClassroomUIEvents(
            AgoraEduClassroomUIEvent.toggleWhiteboard,
            false,
          );
        }
        break;
      case CabinetItemEnum.BreakoutRoom:
        if (this.getters.videoGalleryStarted) {
          this.shareUIStore.addToast(
            transI18n('fcr_expansion_screen_tips_close_expansion_screen'),
            'warning',
          );
        } else {
          this.shareUIStore.addDialog(DialogCategory.BreakoutRoom);
        }
        break;
      case CabinetItemEnum.VideoGallery:
        const dialogOpened = this.shareUIStore.dialogQueue.some(
          ({ category }) => category === DialogCategory.VideoGallery,
        );

        if (dialogOpened) {
          this.logger.info('video gallery already started');
          return;
        }
        if (this.getters.breakoutRoomStarted) {
          this.shareUIStore.addToast(transI18n('fcr_expansion_screen_tips_close_group'), 'warning');
        } else {
          try {
            const area =
              (this.getters.layoutMaskCode & ~LayoutMaskCode.StageVisible) |
              LayoutMaskCode.VideoGalleryVisible;

            if (this.getters.stageUserUuids.length > 0) {
              this.shareUIStore.addToast(
                transI18n('fcr_expansion_screen_tips_need_invite_student_on_stage'),
              );
            }

            await this.classroomStore.handUpStore.offPodiumAll();

            await this.classroomStore.roomStore.updateFlexProperties({ area }, null);

            this.shareUIStore.addDialog(DialogCategory.VideoGallery, { showMask: false });
          } catch (e) {
            this.shareUIStore.addGenericErrorDialog(e as AGError);
          }
        }

        break;
    }
  }

  @action.bound
  handleSliceItem(id: string) {
    try {
      switch (id) {
        case 'slice':
          // 截图
          sendToMainProcess(ChannelType.ShortCutCapture, {
            hideWindow: false,
            module: this.module,
          });
          break;
        case 'slice-window':
          // 隐藏教室截图
          sendToMainProcess(ChannelType.ShortCutCapture, { hideWindow: true, module: this.module });
          break;
        default:
          break;
      }
    } catch (e) {
      this.shareUIStore.addGenericErrorDialog(e as AGError);
    }
  }

  /**
   * 选中工具
   * @param tool
   * @returns
   */
  @action.bound
  setTool(tool: string) {
    const eduTool = this._convertUITools2EduTools(tool);

    if (eduTool.length === 1) {
      this.boardApi.selectTool(eduTool[0] as FcrBoardTool);
    }

    if (eduTool.length === 2) {
      this.boardApi.drawShape(eduTool[1] as FcrBoardShape);
    }

    switch (tool) {
      case 'clear':
        this.boardApi.clean();
        break;
      case 'undo':
        this.boardApi.undo();
        break;
      case 'redo':
        this.boardApi.redo();
        break;
      case 'cloud':
        this._openCloudDrive(tool);
        break;
      case 'register':
        this._openRoster(tool);
        break;
      case 'save':
        this._saveBoardSnapshot();
        break;
    }
  }

  private _openCloudDrive(tool: string) {
    this.shareUIStore.addDialog(DialogCategory.CloudDriver, {
      onClose: () => {
        this._setToolInactive(tool);
      },
    });
    this._setToolActive(tool);
  }

  private _openRoster(tool: string) {
    this.shareUIStore.addDialog(
      EduClassroomConfig.shared.sessionInfo.roomType === EduRoomTypeEnum.RoomBigClass
        ? DialogCategory.LectureRoster
        : DialogCategory.Roster,
      {
        onClose: () => {
          this._setToolInactive(tool);
        },
      },
    );
    this._setToolActive(tool);
  }

  private _saveBoardSnapshot() {
    this.boardApi.getSnapshotImageList();
  }
  @action
  private _setToolActive(tool: string) {
    this.activeMap = { ...this.activeMap, [tool]: true };
  }
  @action
  private _setToolInactive(tool: string) {
    this.activeMap = { ...this.activeMap, [tool]: false };
  }

  // others
  readonly penTools = [
    'pen',
    'square',
    'circle',
    'line',
    'arrow',
    'pentagram',
    'rhombus',
    'triangle',
  ];

  /**
   * 设置画笔粗细
   * @param value
   * @returns
   */
  @bound
  changeStroke(value: number) {
    return this.boardApi.changeStrokeWidth(value);
  }

  /**
   * 设置画笔颜色，支持 RGB 色值
   * @param value
   * @returns
   */
  @bound
  changeHexColor(value: string) {
    const r = parseInt(value.slice(1, 3), 16);
    const g = parseInt(value.slice(3, 5), 16);
    const b = parseInt(value.slice(5, 7), 16);
    return this.boardApi.changeStrokeColor({ r, g, b });
  }

  /**
   * 当前激活的工具
   * @returns
   */
  @computed
  get activeCabinetItems() {
    return this._activeCabinetItems;
  }

  /**
   * 工具箱列表
   * @returns
   */
  @computed
  get cabinetItems(): CabinetItem[] {
    const { role, roomType } = EduClassroomConfig.shared.sessionInfo;
    if(roomType == EduRoomTypeEnum.RoomBigClass){
      const { widgetController } = this.classroomStore.widgetStore;
      const props = widgetController?.getWidgetUserProperties("easemobIM") || {};
  
      const chatGroupUuids = props.chatGroupUuids || []

      // 大班课，主助教工具栏只有屏幕共享
      if(role == EduRoleTypeEnum.assistant && chatGroupUuids.length == 0){
        return [
          {
            id: CabinetItemEnum.ScreenShare,
            iconType: 'share-screen',
            name: transI18n('scaffold.screen_share'),
          },
        ]
      }
    }
    const extapps = [
      {
        id: CabinetItemEnum.ScreenShare,
        iconType: 'share-screen',
        name: transI18n('scaffold.screen_share'),
      },
      {
        id: CabinetItemEnum.BreakoutRoom,
        iconType: 'group-discuss',
        name: transI18n('scaffold.breakout_room'),
      },
      {
        id: CabinetItemEnum.Whiteboard,
        iconType: 'whiteboard',
        name: transI18n('scaffold.whiteboard'),
      },
      {
        id: CabinetItemEnum.VideoGallery,
        iconType: 'video-gallery',
        name: transI18n('fcr_expansion_screen_button_expansion_screen'),
      },
      {
        id: CabinetItemEnum.Laser,
        iconType: 'laser-pointer',
        name: transI18n('scaffold.laser_pointer'),
      },
    ];

    let apps = this.extensionApi.cabinetItems.concat(
      extapps.filter((item) => this.allowedCabinetItems.includes(item.id)),
    );

    const excludes = new Set<string>();

    if (EduClassroomConfig.shared.sessionInfo.role === EduRoleTypeEnum.assistant) {
      excludes.add(CabinetItemEnum.BreakoutRoom);
      excludes.add(CabinetItemEnum.VideoGallery);
    }
    if (!this.boardApi.mounted) {
      excludes.add(CabinetItemEnum.Laser);
    }

    if (this.getters.isInSubRoom) {
      excludes.add(CabinetItemEnum.VideoGallery);
    }

    if (EduRteEngineConfig.platform !== AgoraRteRuntimePlatform.Electron) {
      excludes.add(CabinetItemEnum.VideoGallery);
    }

    apps = apps.filter((it) => !excludes.has(it.id));

    return apps;
  }
  /**
   * 白板清除选项列表
   * @returns
   */
  get boardCleanerItems(): CabinetItem[] {
    const items = [
      {
        id: 'eraser',
        iconType: 'eraser',
        name: transI18n('scaffold.eraser'),
      },
      {
        id: 'clear',
        iconType: 'clear',
        name: transI18n('scaffold.clear'),
      },
    ];

    return items;
  }
  /**
   * 工具栏工具列表
   * @returns
   */
  @computed get tools(): ToolbarItem[] {
    const { role, roomType } = EduClassroomConfig.shared.sessionInfo;

    if(roomType == EduRoomTypeEnum.RoomBigClass){
      const { widgetController } = this.classroomStore.widgetStore;
      const props = widgetController?.getWidgetUserProperties("easemobIM") || {};
  
      const chatGroupUuids = props.chatGroupUuids || []
       
      if(role == EduRoleTypeEnum.teacher){
        return this.teacherTools
      }else if(role == EduRoleTypeEnum.assistant){
        if(chatGroupUuids.length > 0){
          // 子助教工具栏没有花名册
          return this.asisstantTools
        }else{
          // 总助教与老师工具栏一致
          return this.mainAsisstantTools
        }
      }else{
        return this.studentTools;
      }
    }else{
      return [EduRoleTypeEnum.teacher, EduRoleTypeEnum.assistant].includes(role)
      ? this.teacherTools
      : this.studentTools;
    }
  }

  /**
   * 截图选项列表
   * @returns
   */
  get sliceItems(): CabinetItem[] {
    const items = [
      {
        id: 'slice',
        iconType: 'slice',
        name: transI18n('scaffold.slice'),
      },
      {
        id: 'slice-window',
        iconType: 'slice-window',
        name: transI18n('scaffold.slice_window'),
      },
    ];

    return items;
  }

  /**
   * 老师工具栏工具列表
   * @returns
   */
  @computed
  get teacherTools(): ToolbarItem[] {
    let _tools: ToolbarItem[] = [];
    if (this.boardApi.mounted) {
      _tools = [
        ToolbarItem.fromData({
          value: 'clicker',
          label: 'scaffold.clicker',
          icon: 'select',
          category: ToolbarItemCategory.Clicker,
        }),
        ToolbarItem.fromData({
          // selector use clicker icon
          value: 'selection',
          label: 'scaffold.selector',
          icon: 'clicker',
          category: ToolbarItemCategory.Selector,
        }),
        ToolbarItem.fromData({
          value: 'pen',
          label: 'scaffold.pencil',
          icon: 'pen',
          category: ToolbarItemCategory.PenPicker,
        }),
        ToolbarItem.fromData({
          value: 'text',
          label: 'scaffold.text',
          icon: 'text',
          category: ToolbarItemCategory.Text,
        }),
        ToolbarItem.fromData({
          value: 'eraser',
          label: 'scaffold.eraser',
          icon: 'eraser',
          category: ToolbarItemCategory.Eraser,
        }),

        ToolbarItem.fromData({
          value: 'hand',
          label: 'scaffold.move',
          icon: 'hand',
          category: ToolbarItemCategory.Hand,
        }),
        ToolbarItem.fromData({
          value: 'save',
          label: 'scaffold.save',
          icon: 'save-ghost',
          category: ToolbarItemCategory.Save,
        }),

        ToolbarItem.fromData({
          value: 'cloud',
          label: 'scaffold.cloud_storage',
          icon: 'cloud',
          category: ToolbarItemCategory.CloudStorage,
        }),
        ToolbarItem.fromData({
          value: 'tools',
          label: 'scaffold.tools',
          icon: 'tools',
          category: ToolbarItemCategory.Cabinet,
        }),
        ToolbarItem.fromData({
          value: 'register',
          label: 'scaffold.register',
          icon: 'register',
          category: ToolbarItemCategory.Roster,
        }),
      ];

      if (AgoraRteEngineConfig.platform === AgoraRteRuntimePlatform.Electron) {
        _tools.splice(
          5,
          0,
          ToolbarItem.fromData({
            value: 'slice',
            label: 'scaffold.slice',
            icon: 'slice',
            category: ToolbarItemCategory.Slice,
          }),
        );
      }
    } else {
      _tools = [
        ToolbarItem.fromData({
          value: 'tools',
          label: 'scaffold.tools',
          icon: 'tools',
          category: ToolbarItemCategory.Cabinet,
        }),
        ToolbarItem.fromData({
          value: 'register',
          label: 'scaffold.register',
          icon: 'register',
          category: ToolbarItemCategory.Roster,
        }),
      ];
    }

    return _tools;
  }

  /**
   * 主助教老师工具栏工具列表
   * @returns
   */
  @computed
  get mainAsisstantTools(): ToolbarItem[] {
    let _tools: ToolbarItem[] = [];
    if (this.boardApi.mounted) {
      _tools = [
        ToolbarItem.fromData({
          value: 'clicker',
          label: 'scaffold.clicker',
          icon: 'select',
          category: ToolbarItemCategory.Clicker,
        }),
        ToolbarItem.fromData({
          // selector use clicker icon
          value: 'selection',
          label: 'scaffold.selector',
          icon: 'clicker',
          category: ToolbarItemCategory.Selector,
        }),
        ToolbarItem.fromData({
          value: 'pen',
          label: 'scaffold.pencil',
          icon: 'pen',
          category: ToolbarItemCategory.PenPicker,
        }),
        ToolbarItem.fromData({
          value: 'text',
          label: 'scaffold.text',
          icon: 'text',
          category: ToolbarItemCategory.Text,
        }),
        ToolbarItem.fromData({
          value: 'eraser',
          label: 'scaffold.eraser',
          icon: 'eraser',
          category: ToolbarItemCategory.Eraser,
        }),

        ToolbarItem.fromData({
          value: 'hand',
          label: 'scaffold.move',
          icon: 'hand',
          category: ToolbarItemCategory.Hand,
        }),
        ToolbarItem.fromData({
          value: 'save',
          label: 'scaffold.save',
          icon: 'save-ghost',
          category: ToolbarItemCategory.Save,
        }),

        ToolbarItem.fromData({
          value: 'cloud',
          label: 'scaffold.cloud_storage',
          icon: 'cloud',
          category: ToolbarItemCategory.CloudStorage,
        }),
        ToolbarItem.fromData({
          value: 'tools',
          label: 'scaffold.tools',
          icon: 'tools',
          category: ToolbarItemCategory.Cabinet,
        }),
        ToolbarItem.fromData({
          value: 'register',
          label: 'scaffold.register',
          icon: 'register',
          category: ToolbarItemCategory.Roster,
        }),
      ];

      if (AgoraRteEngineConfig.platform === AgoraRteRuntimePlatform.Electron) {
        _tools.splice(
          5,
          0,
          ToolbarItem.fromData({
            value: 'slice',
            label: 'scaffold.slice',
            icon: 'slice',
            category: ToolbarItemCategory.Slice,
          }),
        );
      }
    } else {
      _tools = [
        ToolbarItem.fromData({
          value: 'tools',
          label: 'scaffold.tools',
          icon: 'tools',
          category: ToolbarItemCategory.Cabinet,
        }),
        ToolbarItem.fromData({
          value: 'register',
          label: 'scaffold.register',
          icon: 'register',
          category: ToolbarItemCategory.Roster,
        }),
      ];
    }

    return _tools;
  }


   /**
   * 子助教老师工具栏工具列表
   * @returns
   */
   @computed
   get asisstantTools(): ToolbarItem[] {
     let _tools: ToolbarItem[] = [];
     if (this.boardApi.mounted) {
       _tools = [
         ToolbarItem.fromData({
           value: 'clicker',
           label: 'scaffold.clicker',
           icon: 'select',
           category: ToolbarItemCategory.Clicker,
         }),
         ToolbarItem.fromData({
           // selector use clicker icon
           value: 'selection',
           label: 'scaffold.selector',
           icon: 'clicker',
           category: ToolbarItemCategory.Selector,
         }),
         ToolbarItem.fromData({
           value: 'pen',
           label: 'scaffold.pencil',
           icon: 'pen',
           category: ToolbarItemCategory.PenPicker,
         }),
         ToolbarItem.fromData({
           value: 'text',
           label: 'scaffold.text',
           icon: 'text',
           category: ToolbarItemCategory.Text,
         }),
         ToolbarItem.fromData({
           value: 'eraser',
           label: 'scaffold.eraser',
           icon: 'eraser',
           category: ToolbarItemCategory.Eraser,
         }),
 
         ToolbarItem.fromData({
           value: 'hand',
           label: 'scaffold.move',
           icon: 'hand',
           category: ToolbarItemCategory.Hand,
         }),
         ToolbarItem.fromData({
           value: 'save',
           label: 'scaffold.save',
           icon: 'save-ghost',
           category: ToolbarItemCategory.Save,
         }),
 
         ToolbarItem.fromData({
           value: 'cloud',
           label: 'scaffold.cloud_storage',
           icon: 'cloud',
           category: ToolbarItemCategory.CloudStorage,
         }),
       ];
 
       if (AgoraRteEngineConfig.platform === AgoraRteRuntimePlatform.Electron) {
         _tools.splice(
           5,
           0,
           ToolbarItem.fromData({
             value: 'slice',
             label: 'scaffold.slice',
             icon: 'slice',
             category: ToolbarItemCategory.Slice,
           }),
         );
       }
     } else {
       _tools = [
         ToolbarItem.fromData({
           value: 'register',
           label: 'scaffold.register',
           icon: 'register',
           category: ToolbarItemCategory.Roster,
         }),
       ];
     }
 
     return _tools;
   }

  /**
   * 学生工具栏工具列表
   * @returns
   */
  @computed
  get studentTools(): ToolbarItem[] {
    const { userUuid } = EduClassroomConfig.shared.sessionInfo;
    const mounted = this.boardApi.mounted;
    const whiteboardAuthorized = this.boardApi.grantedUsers.has(userUuid);

    if (!mounted || !whiteboardAuthorized) {
      //allowed to view user list only if not granted
      return [
        ToolbarItem.fromData({
          value: 'register',
          label: 'scaffold.register',
          icon: 'register',
          category: ToolbarItemCategory.Roster,
        }),
      ];
    }
    return [
      ToolbarItem.fromData({
        value: 'clicker',
        label: 'scaffold.clicker',
        icon: 'select',
        category: ToolbarItemCategory.Clicker,
      }),
      ToolbarItem.fromData({
        // selector use clicker icon
        value: 'selection',
        label: 'scaffold.selector',
        icon: 'clicker',
        category: ToolbarItemCategory.Selector,
      }),
      ToolbarItem.fromData({
        value: 'pen',
        label: 'scaffold.pencil',
        icon: 'pen',
        category: ToolbarItemCategory.PenPicker,
      }),
      ToolbarItem.fromData({
        value: 'text',
        label: 'scaffold.text',
        icon: 'text',
        category: ToolbarItemCategory.Text,
      }),
      ToolbarItem.fromData({
        value: 'eraser',
        label: 'scaffold.eraser',
        icon: 'eraser',
        category: ToolbarItemCategory.Eraser,
      }),
      ToolbarItem.fromData({
        value: 'register',
        label: 'scaffold.register',
        icon: 'register',
        category: ToolbarItemCategory.Roster,
      }),
    ];
  }

  /**
   * 转 Edu 工具 对象
   * @param tool
   * @returns
   */
  private _convertUITools2EduTools(tool: string): Array<number | undefined> {
    switch (tool) {
      case 'clicker':
        return [FcrBoardTool.Clicker];
      case 'selection':
        return [FcrBoardTool.Selector];
      case 'eraser':
        return [FcrBoardTool.Eraser];
      case 'hand':
        return [FcrBoardTool.Hand];
      case 'laser':
        return [FcrBoardTool.LaserPointer];
      case 'text':
        return [FcrBoardTool.Text];
      case 'arrow':
        return [, FcrBoardShape.Arrow];
      case 'pen':
        return [, FcrBoardShape.Curve];
      case 'square':
        return [, FcrBoardShape.Rectangle];
      case 'circle':
        return [, FcrBoardShape.Ellipse];
      case 'line':
        return [, FcrBoardShape.Straight];
      case 'pentagram':
        return [, FcrBoardShape.Pentagram];
      case 'rhombus':
        return [, FcrBoardShape.Rhombus];
      case 'triangle':
        return [, FcrBoardShape.Triangle];
    }
    return [];
  }

  /**
   * 转 UI 工具对象
   * @param tool
   * @returns
   */
  private _convertEduTools2UITools(tool?: FcrBoardTool, shape?: FcrBoardShape) {
    switch (tool) {
      case FcrBoardTool.Clicker:
        return 'clicker';
      case FcrBoardTool.Selector:
        return 'selection';
      case FcrBoardTool.Eraser:
        return 'eraser';
      case FcrBoardTool.Hand:
        return 'hand';
      case FcrBoardTool.Text:
        return 'text';
    }
    switch (shape) {
      case FcrBoardShape.Curve:
        return 'pen';
      case FcrBoardShape.Rectangle:
        return 'square';
      case FcrBoardShape.Ellipse:
        return 'circle';
      case FcrBoardShape.Straight:
        return 'line';
      case FcrBoardShape.Arrow:
        return 'arrow';
      case FcrBoardShape.Pentagram:
        return 'pentagram';
      case FcrBoardShape.Triangle:
        return 'triangle';
      case FcrBoardShape.Rhombus:
        return 'rhombus';
    }
  }

  /**
   * 把截图贴到白板中
   * @param dataURL
   */
  private async _pastToBoard(dataURL: string) {
    const ext = 'png';
    const file = dataURIToFile(dataURL, `agora-screen-shot-${Date.now()}.${ext}`);

    const resourceUuid = await this.classroomStore.cloudDriveStore.calcResourceUuid(file);
    const contentType = fileExt2ContentType(ext);
    const conversion = conversionOption(ext);

    const resourceInfo = await this.classroomStore.cloudDriveStore.uploadPersonalResource(
      file,
      resourceUuid,
      ext,
      contentType,
      conversion,
    );
    if (resourceInfo?.url) {
      this.boardApi.putImageResource(resourceInfo.url);
    }
  }

  onDestroy() {
    this._disposers.forEach((d) => d());
    this._disposers = [];
  }
}
