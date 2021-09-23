import React, { useState, useRef } from 'react';
import { useSelector } from 'react-redux';
import { Switch, Tooltip, Input, Button, message, Modal } from 'antd';
import { MSG_TYPE } from '../../contants';
import store from '../../redux/store';
import { transI18n } from '~ui-kit';
import { messageAction, showEmojiAction } from '../../redux/actions/messageAction';
import { setAllmute, removeAllmute } from '../../api/mute';
import emoji from '../../utils/emoji';

import emojiIcon from '../../themes/img/emoji.png';
import './index.css';

// 展示表情
export const ShowEomji = ({ getEmoji }) => {
  return (
    <div>
      {Object.keys(emoji.map).map((k, index) => {
        const v = emoji.map[k];
        return (
          <img
            key={k}
            className="emoji-content"
            src={require(`../../themes/faces/${v}`).default}
            onClick={() => {
              getEmoji(k);
            }}
          />
        );
      })}
    </div>
  );
};

export const InputMsg = ({ isTeacher }) => {
  const state = useSelector((state) => state);
  const loginUser = state?.loginUser;
  const roomId = state?.room.info.id;
  const roleType = state?.loginUserInfo.ext;
  const roomUuid = state?.propsData.roomUuid;
  const userAvatarUrl = state?.loginUserInfo.avatarurl;
  const userNickName = state?.loginUserInfo.nickname;
  const isAllMute = state?.room.allMute;
  const isShowEmoji = state?.showEmoji;

  // 管理输入框内容
  const [content, setContent] = useState('');
  // 输入框焦点
  const inputRef = useRef(null);

  // 显示表情框
  const showEmoji = () => {
    store.dispatch(showEmojiAction(true));
  };
  // 隐藏表情框
  const handleCancel = () => {
    Modal.destroyAll();
    store.dispatch(showEmojiAction(false));
  };

  // 获取到点击的表情，加入到输入框
  const getEmoji = (val) => {
    // e.preventDefault();
    // 监听表情输入后，自动获取输入框焦点
    inputRef.current.focus({
      cursor: 'end',
    });
    // 本次输入的内容
    let tempContent = val;
    // 更新内容和长度
    let totalContent = content + tempContent;
    setContent(totalContent);
  };

  // 全局禁言开关
  const onChangeMute = (val) => {
    if (!val) {
      setAllmute(roomId);
    } else {
      removeAllmute(roomId);
    }
  };

  // 监听输入框变化
  const changeMsg = (e) => {
    let msgContent = e.target.value;
    setContent(msgContent);
  };

  // 发送消息
  const sendTextMessage = () => (e) => {
    e.preventDefault();
    // 消息为空不发送
    if (content.match(/^\s*$/)) {
      message.error(transI18n('chat.enter_content_is_empty'));
      return;
    }
    let id = WebIM.conn.getUniqueId(); // 生成本地消息id
    let msg = new WebIM.message('txt', id); // 创建文本消息
    let option = {
      msg: content, // 消息内容
      to: roomId, // 接收消息对象(聊天室id)
      from: loginUser,
      chatType: 'chatRoom', // 群聊类型设置为聊天室
      ext: {
        msgtype: MSG_TYPE.common, // 消息类型
        roomUuid: roomUuid,
        role: JSON.parse(roleType).role,
        avatarUrl: userAvatarUrl || '',
        nickName: userNickName,
      }, // 扩展消息
      success: function (id, serverId) {
        handleCancel();
        msg.id = serverId;
        msg.body.id = serverId;
        msg.body.time = new Date().getTime().toString();
        store.dispatch(messageAction(msg.body, { isHistory: false }));
      }, // 对成功的相关定义，sdk会将消息id登记到日志进行备份处理
      fail: function (err) {
        console.log('fail>>>', err);
        if (err.type === 501) {
          message.error(transI18n('chat.message_incloud_illegal_content'));
        }
      },
    };
    msg.set(option);
    setContent('');
    WebIM.conn.send(msg.body);
  };

  return (
    <>
      <div>
        <div className="chat-icon">
          {/* <Tooltip title="表情">
                    
                </Tooltip> */}
          <img src={emojiIcon} className="emoji-icon" onClick={showEmoji} />
          {isTeacher && (
            <div>
              <span className="all-mute-text">{transI18n('chat.all_mute')}</span>
              <Switch
                size="small"
                checked={isAllMute}
                onClick={() => {
                  onChangeMute(isAllMute);
                }}
              />
            </div>
          )}
        </div>
        <Input.TextArea
          placeholder={transI18n('chat.enter_contents')}
          className="input-chat"
          autoFocus
          onChange={(e) => changeMsg(e)}
          value={content}
          onPressEnter={sendTextMessage()}
          ref={inputRef}
        />
        <div className="input-btn">
          <Button type="primary" className="send-btn" onClick={sendTextMessage()}>
            {transI18n('chat.send')}
          </Button>
        </div>
      </div>
      <Modal
        visible={isShowEmoji}
        onCancel={() => {
          handleCancel();
        }}
        width={280}
        footer={''}
        closable={false}
        style={{
          width: '280px',
          position: 'absolute',
          bottom: '110px',
          right: '10px',
        }}
        className="emoji-modal"
        destroyOnClose
        maskStyle={{ backgroundColor: 'rgba(0,0,0,0)' }}>
        <ShowEomji getEmoji={getEmoji} />
      </Modal>
    </>
  );
};
