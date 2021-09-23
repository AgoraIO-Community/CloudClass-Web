import emoji from './emoji';
// 渲染图片表情
const renderEmoji = (txtMsg, rnTxt) => {
  let match = null;
  const regex = /(\[.*?\])/g;
  let start = 0;
  let index = 0;
  while ((match = regex.exec(txtMsg))) {
    index = match.index;
    if (index > start) {
      rnTxt.push(txtMsg.substring(start, index));
    }
    if (match[1] in emoji.map) {
      const v = emoji.map[match[1]];
      rnTxt.push(
        <img
          key={WebIM.conn.getUniqueId()}
          src={require(`../themes/faces/${v}`).default}
          style={{ width: '20px', height: '20px', display: 'inline-block' }}
        />,
      );
    } else {
      rnTxt.push(match[1]);
    }
    start = index + match[1].length;
  }
  rnTxt.push(txtMsg.substring(start, txtMsg.length));
  return rnTxt;
};

export default renderEmoji;
