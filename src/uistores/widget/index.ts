import { AgoraEduSDK } from '@classroom/index';
import {
  counterEnabled,
  pollEnabled,
  popupQuizEnabled,
  chatEnabled,
  boardEnabled,
  AgoraCloudClassWidget as AgoraWidgetBase,
  AgoraWidgetTrackMode,
  AgoraWidgetTrackController,
  AgoraUiCapableConfirmDialogProps,
} from 'agora-common-libs';
import { WidgetState, AgoraWidgetTrack, AgoraWidgetController } from 'agora-edu-core';
import { bound, Log } from 'agora-rte-sdk';
import { action, computed, IReactionDisposer, Lambda, observable, reaction } from 'mobx';
import { EduUIStoreBase } from '../base';
import { AgoraExtensionRoomEvent, AgoraExtensionWidgetEvent } from '@classroom/protocol/events';

@Log.attach({ proxyMethods: false })
export class WidgetUIStore extends EduUIStoreBase {
  private _disposers: (Lambda | IReactionDisposer)[] = [];
  private _registeredWidgets: Record<string, typeof AgoraWidgetBase> = {};
  private _viewportResizeObserver?: ResizeObserver;
  @observable
  private _currentWidget: any;
  @observable
  private _widgetInstances: Record<string, AgoraWidgetBase> = {};
  private _stateListener = {
    onActive: this._handleWidgetActive,
    onInactive: this._handleWidgetInactive,
    onPropertiesUpdate: this._handlePropertiesUpdate,
    onUserPropertiesUpdate: this._handleUserPropertiesUpdate,
    onTrackUpdate: this._handleTrackUpdate,
  };

  @computed
  get ready() {
    return !!this.classroomStore.widgetStore.widgetController;
  }

  @computed
  get registeredWidgetNames() {
    return Object.keys(this._registeredWidgets);
  }

  @computed
  get widgetInstanceList() {
    return Object.values(this._widgetInstances);
  }
  @computed
  get currentWidget() {
    console.log('currentWidgetcurrentWidget', this._currentWidget);
    return this._currentWidget;
  }
  @computed
  get z0Widgets() {
    const widgets = this.widgetInstanceList.filter(({ zContainer }) => zContainer === 0);
    console.log('z0Widgetsz0Widgetsz0Widgets', widgets);
    const arr: any = [];
    for (let i = 0; i < widgets.length; i++) {
      const item = widgets[i];
      arr.unshift(item);
    }
    const shareWidget = arr.filter((item: { widgetId: string; }) => item.widgetId === "screenShare");
    if (this.shareUIStore.isLandscape && !shareWidget) {
      arr.push({
        widgetId: "screenShare",
        widgetName: "screenShare",
      })
    }
    return arr;
  }

  get z10Widgets() {
    return this.widgetInstanceList.filter(({ zContainer }) => zContainer === 10);
  }
  @action.bound
  setCurrentWidget(widget: any) {
    const { widgetController } = this.classroomStore.widgetStore;
    if (widgetController) {
      console.log('setCurrentWidgetsetCurrentWidget', widget);
      widgetController.broadcast(AgoraExtensionRoomEvent.DefaultCurrentApplication, widget);
    }
  }
  @action.bound
  private _setCurrentWidget(widget: any) {
    this._currentWidget = widget;
  }
  @action.bound
  createWidget(
    widgetId: string,
    defaults?: Record<'properties' | 'userProperties' | 'trackProperties', any>,
  ) {
    const [widgetName, instanceId] = this._extractWidgetNameId(widgetId);

    const WidgetClass = this._registeredWidgets[widgetName];

    if (!WidgetClass) {
      this.logger.info(`widget [${widgetName}] is active but not registered`);
      return;
    }

    if (this._widgetInstances[widgetId]) {
      this.logger.info(`widget [${widgetName}] is already active`);
      return;
    }

    const { widgetController } = this.classroomStore.widgetStore;

    if (widgetController) {
      const widget = new (WidgetClass as any)(
        widgetController,
        this.classroomStore,
        this._createUiCapable(),
        AgoraEduSDK.uiConfig,
        AgoraEduSDK.theme,
      ) as AgoraWidgetBase;

      this.logger.info('widget instance is created:', widgetId);

      if (instanceId) {
        this._callWidgetSetInstanceId(widget, instanceId);
      }

      const trackProps =
        widgetController.getWidgetTrack(widget.widgetId) || (defaults?.trackProperties ?? {});

      this.logger.info('widget trackProps:', trackProps);

      const trackMode = this._getWidgetTrackMode(widget);

      this.logger.info('widget trackMode:', trackMode);

      if (trackMode) {
        const trackController = new AgoraWidgetTrackController(
          widget,
          {
            position: {
              xaxis: 0,
              yaxis: 0,
            },
          },
          {
            posOnly: trackMode === AgoraWidgetTrackMode.TrackPositionOnly,
          },
        );

        widget.setTrackController(trackController);

        this.logger.info('set widget track controller:', trackController);
      }

      const props =
        widgetController?.getWidgetProperties(widget.widgetId) || (defaults?.properties ?? {});

      this.logger.info('widget props:', props);

      const userProps =
        widgetController?.getWidgetUserProperties(widget.widgetId) ||
        (defaults?.userProperties ?? {});

      this._callWidgetCreate(widget, props, userProps);

      this._widgetInstances[widgetId] = widget;
      const widgets = Object.values(this._widgetInstances).filter(
        ({ zContainer }) => zContainer === 0,
      );
      const allWidgets = widgets.filter((v) => v.widgetName !== 'easemobIM');
      if (allWidgets.length && !this._currentWidget) {
        this._setCurrentWidget(allWidgets[allWidgets.length - 1]);
      }
      // console.log('AgoraExtensionRoomEvent.GetApplications', this._widgetInstances)
      // widgetController.broadcast(AgoraExtensionRoomEvent.GetApplications, this._widgetInstances)

      this.logger.info(`widget [${widgetId}] is ready to render`);
    } else {
      this.logger.info('widget controller not ready for creating widget');
    }
  }

  @action.bound
  destroyWidget(widgetId: string) {
    const widget = this._widgetInstances[widgetId];
    if (widget) {
      if (widget.trackController) {
        widget.trackController.destory();
      }
      this._callWidgetDestroy(widget);
      delete this._widgetInstances[widgetId];
    }
  }

  private _extractWidgetNameId(widgetId: string) {
    const [widgetName, instanceId] = widgetId.split('-');
    return [widgetName, instanceId];
  }

  @bound
  private _handleWidgetActive(widgetId: string) {
    this.createWidget(widgetId);
    const widgetInstances = Object.values(this._widgetInstances);
    const z0Widgets = widgetInstances.filter(({ zContainer }) => zContainer === 0);
    const item = z0Widgets.find((v) => v.widgetId === widgetId);
    console.log('_handleWidgetActive_handleWidgetActive', item);
    this.setCurrentWidget(item || z0Widgets[z0Widgets.length - 1]);
    this._setCurrentWidget(item || z0Widgets[z0Widgets.length - 1]);
  }

  @bound
  private _handleWidgetInactive(widgetId: string) {
    console.log('_handleWidgetInactive_handleWidgetInactive', this.z0Widgets, widgetId);
    const arr = this.z0Widgets.filter((v: { widgetId: string }) => v.widgetId !== widgetId);
    debugger
    const index = arr.findIndex(
      (v: { widgetId: any }) => v.widgetId === this._currentWidget.widgetId,
    );
    if (index === -1) {
      this.setCurrentWidget(arr[0]);
      this._setCurrentWidget(arr[0]);
    }

    this.destroyWidget(widgetId);
  }

  @bound
  private _handlePropertiesUpdate(widgetId: string, props: unknown) {
    const widget = this._widgetInstances[widgetId];
    if (widget) {
      this._callWidgetPropertiesUpdate(widget, props);
    }
  }

  @bound
  private _handleUserPropertiesUpdate(widgetId: string, userProps: unknown) {
    const widget = this._widgetInstances[widgetId];
    if (widget) {
      this._callWidgetUserPropertiesUpdate(widget, userProps);
    }
  }

  @bound
  private _handleTrackUpdate(widgetId: string, trackProps: unknown) {
    const widget = this._widgetInstances[widgetId];
    if (widget) {
      this._callWidgetUpdateTrack(widget, trackProps);
    }
  }

  private _callWidgetCreate(widget: AgoraWidgetBase, props: unknown, userProps: unknown) {
    if (widget.onCreate) {
      this.logger.info(
        `call widget [${widget.widgetId}] onCreate, props: ${JSON.stringify(
          props,
        )}, userProps: ${JSON.stringify(userProps)}`,
      );
      widget.onCreate(props, userProps);
    }
  }

  private _callWidgetSetInstanceId(widget: AgoraWidgetBase, instanceId: string) {
    if (widget.setInstanceId) {
      this.logger.info(`call widget [${widget.widgetId}] setInstanceId, instanceId: ${instanceId}`);
      widget.setInstanceId(instanceId);
    }
  }

  private _callWidgetPropertiesUpdate(widget: AgoraWidgetBase, props: unknown) {
    if (widget.onPropertiesUpdate) {
      this.logger.info(
        `call widget [${widget.widgetId}] onPropertiesUpdate, props: ${JSON.stringify(props)}`,
      );
      widget.onPropertiesUpdate(props);
    }
  }
  private _callWidgetUserPropertiesUpdate(widget: AgoraWidgetBase, userProps: unknown) {
    if (widget.onUserPropertiesUpdate) {
      this.logger.info(
        `call widget [${widget.widgetId}] onUserPropertiesUpdate, userProps: ${JSON.stringify(
          userProps,
        )}`,
      );
      widget.onUserPropertiesUpdate(userProps);
    }
  }

  private _callWidgetDestroy(widget: AgoraWidgetBase) {
    if (widget.onDestroy) {
      this.logger.info(`call widget [${widget.widgetId}] onDestroy`);
      widget.onDestroy();
    }
  }

  private _callWidgetUpdateTrack(widget: AgoraWidgetBase, trackProps: unknown) {
    if (widget.updateToLocal) {
      widget.updateToLocal(trackProps as AgoraWidgetTrack);
      widget.updateZIndexToLocal((trackProps as AgoraWidgetTrack).zIndex ?? 0);
    }
  }

  private _getWidgetTrackMode(widget: AgoraWidgetBase) {
    return widget.trackMode;
  }

  private _callWidgetInstall(widget: AgoraWidgetBase, controller: AgoraWidgetController) {
    if (widget.onInstall) {
      this.logger.info(`call widget [${widget.widgetName}] onInstall`);
      widget.onInstall(controller);
    }
  }

  private _callWidgetUninstall(widget: AgoraWidgetBase, controller: AgoraWidgetController) {
    if (widget.onUninstall) {
      this.logger.info(`call widget [${widget.widgetName}] onUninstall`);
      widget.onUninstall(controller);
    }
  }

  private _installWidgets(controller: AgoraWidgetController) {
    Object.values(this._registeredWidgets).forEach((Clz) => {
      this._callWidgetInstall(Object.create(Clz.prototype), controller);
    });
  }

  private _uninstallWidgets(controller: AgoraWidgetController) {
    Object.values(this._registeredWidgets).forEach((Clz) => {
      this._callWidgetUninstall(Object.create(Clz.prototype), controller);
    });
  }

  @bound
  private _handleBecomeActive({
    widgetId,
    defaults,
  }: {
    widgetId: string;
    defaults: {
      properties: any;
      userProperties: any;
      trackProperties: any;
    };
  }) {
    this.createWidget(widgetId, defaults);
  }

  @bound
  private _handleBecomeInactive(widgetId: string) {
    if (this._currentWidget.widgetId === widgetId) {
      this._setCurrentWidget(this.z0Widgets[0]);
    }
    this.destroyWidget(widgetId);
  }

  private _getEnabledWidgets() {
    const widgets = Object.entries(AgoraEduSDK.widgets).reduce((prev, [key, value]) => {
      // if (!popupQuizEnabled(AgoraEduSDK.uiConfig) && key === 'popupQuiz') {
      //   return prev;
      // }

      // if (!counterEnabled(AgoraEduSDK.uiConfig) && key === 'countdownTimer') {
      //   return prev;
      // }

      // if (!pollEnabled(AgoraEduSDK.uiConfig) && key === 'poll') {
      //   return prev;
      // }

      // if (!chatEnabled(AgoraEduSDK.uiConfig) && key === 'easemobIM') {
      //   return prev;
      // }

      // if (!boardEnabled(AgoraEduSDK.uiConfig) && key === 'netlessBoard') {
      //   return prev;
      // }

      prev[key] = value;

      return prev;
    }, {} as any);

    return widgets;
  }
  @action.bound
  private _notifyViewportChange() {
    console.log(
      '_notifyViewportChange_notifyViewportChange',
      this.classroomStore.widgetStore.widgetController,
    );
    this.classroomStore.widgetStore.widgetController?.broadcast(
      AgoraExtensionRoomEvent.GetApplications,
      this._widgetInstances,
    );
    this.widgetInstanceList.forEach((instance) => {
      const clientRect = document
        .querySelector(`.${this.shareUIStore.classroomViewportClassName}`)
        ?.getBoundingClientRect();

      if (clientRect && instance.onViewportBoundaryUpdate) {
        instance.onViewportBoundaryUpdate(clientRect);
      } else {
        this.logger.warn(
          'cannot get viewport boudnaries by classname:',
          this.shareUIStore.classroomViewportClassName,
        );
      }
    });
  }
  private _createUiCapable() {
    return {
      addToast: (message: string, type: 'error' | 'success' | 'warning') => {
        this.shareUIStore.addToast(message, type);
      },
      addConfirmDialog: (params: AgoraUiCapableConfirmDialogProps) => {},
    };
  }
  @action.bound
  private _handleChangeRoom(controller: AgoraWidgetController) {
    controller.broadcast(AgoraExtensionRoomEvent.GetApplications, this._widgetInstances);
  }

  onInstall() {
    this._registeredWidgets = this._getEnabledWidgets();
    // switch between widget controllers of scenes
    this._disposers.push(
      reaction(
        () => ({
          controller: this.classroomStore.widgetStore.widgetController,
          ready: this.shareUIStore.layoutReady,
        }),
        ({ controller, ready }) => {
          // wait until the layout is ready
          if (ready && controller) {
            controller.widgetIds.forEach((widgetId) => {
              const state = controller.getWidgetState(widgetId);
              if (state === WidgetState.Active) {
                this._handleWidgetActive(widgetId);
              }
            });
          }
        },
      ),
    );

    this._disposers.push(
      computed(() => this.classroomStore.widgetStore.widgetController).observe(
        ({ oldValue: oldController, newValue: controller }) => {
          // destory all widget instances after switched to a new scene
          this.widgetInstanceList.forEach((instance) => {
            this._handleWidgetInactive(instance.widgetId);
          });
          // uninstall all installed widgets
          if (oldController) {
            this._uninstallWidgets(oldController);
            this.boardApi.uninstall();
            this.extensionApi.uninstall();

            oldController.removeBroadcastListener({
              messageType: AgoraExtensionWidgetEvent.WidgetBecomeActive,
              onMessage: this._handleBecomeActive,
            });
            oldController.removeBroadcastListener({
              messageType: AgoraExtensionWidgetEvent.WidgetBecomeInactive,
              onMessage: this._handleBecomeInactive,
            });
            oldController.removeBroadcastListener({
              messageType: AgoraExtensionRoomEvent.SetCurrentApplication,
              onMessage: this._setCurrentWidget,
            });
            oldController.removeWidgetStateListener(this._stateListener);
          }
          // install widgets
          if (controller) {
            this.boardApi.install(controller);
            this.extensionApi.install(controller);
            this._installWidgets(controller);
            controller.addBroadcastListener({
              messageType: AgoraExtensionWidgetEvent.WidgetBecomeActive,
              onMessage: this._handleBecomeActive,
            });
            controller.addBroadcastListener({
              messageType: AgoraExtensionWidgetEvent.WidgetBecomeInactive,
              onMessage: this._handleBecomeInactive,
            });
            controller.addBroadcastListener({
              messageType: AgoraExtensionRoomEvent.SetCurrentApplication,
              onMessage: this._setCurrentWidget,
            });
            console.log(
              'this.classroomStore.widgetStore.widgetControllerthis.classroomStore.widgetStore.widgetController',
              controller,
            );
            controller.broadcast(AgoraExtensionRoomEvent.GetApplications, this._widgetInstances);
            controller.addWidgetStateListener(this._stateListener);
            controller.addBroadcastListener({
              messageType: AgoraExtensionRoomEvent.ChangeRoom,
              onMessage: () => this._handleChangeRoom(controller),
            });
          }
        },
      ),
    );
    this._disposers.push(
      reaction(
        () => this.shareUIStore.layoutReady,
        (layoutReady) => {
          if (layoutReady) {
            this._viewportResizeObserver = this.shareUIStore.addViewportResizeObserver(
              this._notifyViewportChange,
            );
          } else {
            if (this._viewportResizeObserver) {
              this._viewportResizeObserver?.disconnect();
              this._viewportResizeObserver = undefined;
            }
          }
        },
      ),
    );

    this._disposers.push(reaction(() => this.widgetInstanceList, this._notifyViewportChange));
  }

  onDestroy() {
    if (this._viewportResizeObserver) {
      this._viewportResizeObserver?.disconnect();
      this._viewportResizeObserver = undefined;
    }
    this.classroomStore.widgetStore.widgetController?.removeWidgetStateListener(
      this._stateListener,
    );
    this._disposers.forEach((d) => d());
    this._disposers = [];
    //@ts-ignore
    window.imManager.destory();
  }
}
