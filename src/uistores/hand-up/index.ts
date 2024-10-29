import { action, computed, observable, reaction, runInAction } from 'mobx';
import { EduUIStoreBase } from '../base';
import { Scheduler, bound, transI18n } from 'agora-common-libs';
import { OnPodiumStateEnum } from './type';
import {
  CustomMessageCommandType,
  CustomMessageData,
  CustomMessageHandsUpAllType,
  CustomMessageHandsUpState,
  CustomMessageHandsUpType,
} from '../type';
import { getRandomInt } from '@classroom/utils';
import { AgoraExtensionWidgetEvent } from '@classroom/protocol/events';
import { AgoraRteCustomMessage } from 'agora-rte-sdk';
import { EduClassroomConfig, EduRoleTypeEnum } from 'agora-edu-core';

export class HandUpUIStore extends EduUIStoreBase {
  private _handsUpTask: Scheduler.Task | null = null;
  private _isRaiseHand = false;
  @observable
  handsUpMap: Map<string, number> = new Map();
  private _handsUpListScanTask: Scheduler.Task | null = null;
  @action.bound
  addHandsUpStudent(userUuid: string) {
    this.handsUpMap.set(userUuid, Date.now());
  }
  @action.bound
  removeHandsUpStudent(userUuid: string) {
    this.handsUpMap.delete(userUuid);
  }
  @action.bound
  startHandsUpMapScan() {
    const gapInMs = 6000;
    this._handsUpListScanTask = Scheduler.shared.addIntervalTask(() => {
      const now = Date.now();
      this.handsUpMap.forEach((time, key) => {
        if (now - time > gapInMs) {
          runInAction(() => {
            this.removeHandsUpStudent(key);
          });
        }
      });
    }, gapInMs);
  }
  @action.bound
  stopHandsUpListScan() {
    this._handsUpListScanTask?.stop();
  }
  @bound
  private _handleRaiseHand() {
    if (this._isRaiseHand) return;
    const localUserUuid = this.classroomStore.userStore.localUser!.userUuid;
    this._isRaiseHand = true;
    this.getters.classroomUIStore.streamUIStore.handleHandState({ events: [{ action: 1 }], cmd: 1503 })
    this.extensionApi.updateRaiseHandState(CustomMessageHandsUpState.raiseHand);
    const intervalInMs = getRandomInt(2000, 4000);
    this._handsUpTask = Scheduler.shared.addIntervalTask(
      () => {
        const message: CustomMessageData<CustomMessageHandsUpType> = {
          cmd: CustomMessageCommandType.handsUp,
          data: {
            userUuid: localUserUuid,
            state: CustomMessageHandsUpState.raiseHand,
          },
        };
        this.classroomStore.roomStore.sendCustomChannelMessage(message);
      },
      intervalInMs,
      true,
    );
  }
  @bound
  private _handleLowerHand(userUuid?: string) {
    const localUserUuid = this.classroomStore.userStore.localUser?.userUuid;

    const uuid = userUuid || localUserUuid;
    if (!uuid) {
      return
    }
    this._isRaiseHand = false;
    this.getters.classroomUIStore.streamUIStore.handleHandState({ events: [{ action: 2 }], cmd: 1503 })
    this.extensionApi.updateRaiseHandState(CustomMessageHandsUpState.lowerHand);
    this._handsUpTask?.stop();
    const message: CustomMessageData<CustomMessageHandsUpType> = {
      cmd: CustomMessageCommandType.handsUp,
      data: {
        userUuid: uuid,
        state: CustomMessageHandsUpState.lowerHand,
      },
    };
    this.classroomStore.roomStore.sendCustomChannelMessage(message);

  }

  private _disposers: (() => void)[] = [];
  @bound private _onReceivePeerMessage(message: AgoraRteCustomMessage) {}
  @bound
  private _onReceiveChannelMessage(message: AgoraRteCustomMessage) {
    const cmd = message.payload.cmd as CustomMessageCommandType;
    const localUserUuid = this.classroomStore.userStore.localUser?.userUuid;

    switch (cmd) {
      case CustomMessageCommandType.handsUp: {
        const data = message.payload.data as CustomMessageHandsUpType;
        const { userUuid, state } = data;
        if (state === CustomMessageHandsUpState.raiseHand) {
          this.addHandsUpStudent(userUuid);
        } else if (state === CustomMessageHandsUpState.lowerHand) {
          this.removeHandsUpStudent(userUuid);
        }
      }
    }


    if (message.fromUser.userUuid !== localUserUuid) {
      switch (cmd) {
        case CustomMessageCommandType.handsUp: {
          const data = message.payload.data as CustomMessageHandsUpType;
          const { userUuid, state } = data;

          if (state === CustomMessageHandsUpState.raiseHand) {
            this.addHandsUpStudent(userUuid);
          } else if (state === CustomMessageHandsUpState.lowerHand) {
            this.removeHandsUpStudent(userUuid);
          }

          if (state === CustomMessageHandsUpState.lowerHand) {
            const localUserUuid = this.classroomStore.userStore.localUser?.userUuid;
            if (userUuid === localUserUuid) {
              this._handleLowerHand();
              this.shareUIStore.addSingletonToast(transI18n('fcr_room_tips_lower_hand'), 'info');
            }
          }
          break;
        }
        case CustomMessageCommandType.handsUpAll: {
          const data = message.payload.data as CustomMessageHandsUpAllType;
          if (data.roomId && data.roomId !== this.classroomStore.connectionStore.sceneId) return;
          const { operation } = data;
          if (operation === CustomMessageHandsUpState.lowerHand) {
            this._handleLowerHand();
            this.shareUIStore.addSingletonToast(transI18n('fcr_room_tips_lower_all_hand'), 'info');
          }
        }
      }
    }
  }
  onInstall() {
    const isStudent = EduClassroomConfig.shared.sessionInfo.role === EduRoleTypeEnum.student;
    isStudent &&
      this.classroomStore.roomStore.addCustomMessageObserver({
        onReceiveChannelMessage: this._onReceiveChannelMessage,
        onReceivePeerMessage: this._onReceivePeerMessage,
      });
    this._disposers.push(
      reaction(
        () => this.classroomStore.connectionStore.scene,
        () => {
          this._handleLowerHand();
        },
      ),
    );
    this._disposers.push(
      computed(() => this.classroomStore.widgetStore.widgetController).observe(
        ({ newValue, oldValue }) => {
          if (oldValue) {
            const widgetController = oldValue;
            widgetController.removeBroadcastListener({
              messageType: AgoraExtensionWidgetEvent.RaiseHand,
              onMessage: this._handleRaiseHand,
            });
            widgetController.removeBroadcastListener({
              messageType: AgoraExtensionWidgetEvent.LowerHand,
              onMessage: this._handleLowerHand,
            });
          }
          if (newValue) {
            const widgetController = newValue;
            widgetController.addBroadcastListener({
              messageType: AgoraExtensionWidgetEvent.RaiseHand,
              onMessage: this._handleRaiseHand,
            });
            widgetController.addBroadcastListener({
              messageType: AgoraExtensionWidgetEvent.LowerHand,
              onMessage: this._handleLowerHand,
            });
          }
        },
      ),
    );
  }

  onDestroy() {
    const isStudent = EduClassroomConfig.shared.sessionInfo.role === EduRoleTypeEnum.student;
    isStudent &&
      this.classroomStore.roomStore.removeCustomMessageObserver({
        onReceiveChannelMessage: this._onReceiveChannelMessage,
        onReceivePeerMessage: this._onReceivePeerMessage,
      });
    this._disposers.forEach((d) => d());
    this._disposers = [];
    this._handsUpTask?.stop();
  }
}
