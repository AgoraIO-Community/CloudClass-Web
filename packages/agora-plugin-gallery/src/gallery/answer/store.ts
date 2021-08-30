import { action, observable, computed, runInAction } from 'mobx';
import type { AgoraExtAppContext, AgoraExtAppHandle } from 'agora-edu-core'
import { EduRoleTypeEnum } from 'agora-rte-sdk';
import { Toast, transI18n } from '~ui-kit'

const formatTime = (long: number) => {
    let h: any = Math.floor(long / (60 * 60));
    h = (h < 10 ? '0' : '') + h
    let m: any = Math.floor(long / 60) % 60;
    m = (m < 10 ? '0' : '') + m
    let s: any = Math.floor(long % 60);
    s = (s < 10 ? '0' : '') + s
    return h + ':' + m + ':' + s;
}

const getStudentInfo = (info: any) => {
    if (info === null || typeof info === 'undefined' || info === 'deleted' || JSON.stringify(info) === "{}") {
        return null;
    }
    return info;
}

export class PluginStore {
    context: AgoraExtAppContext
    handle: AgoraExtAppHandle

    @observable
    height?: number = 150
    @observable
    title?: string = ''
    @observable
    answer?: string[] = ['A', 'B', 'C', 'D']//备选答案
    @observable
    selAnswer?: string[] = []//选中答案
    @observable
    currentTime?: string = ''//当前时间
    @observable
    students?: any[]//学生信息列表([{name, replyTime, answer},...]),老师使用
    @observable
    status: string = 'config'//当前状态：config(老师设置选项),answer(学生答题),info(答题进行中，老师或学生显示信息),end(答题结束)
    @observable
    answerInfo?: { 'number-answered': string, 'acc': string, 'right-key': string, 'my-answer': string }//答题信息
    @observable
    buttonName?: string = 'answer.start'//按钮文本
    @observable
    ui?: string[] = ['sels']//界面显示配置：'sels'(选项列表),'users'(学生列表),'infos'(答题信息),'subs'(底部按钮)
    @observable
    timehandle?: any = null//保存时间刷新函数的句柄
    @observable
    globalContext: any = {}
    @observable
    showModifyBtn: boolean = false//当前是否显示修改按钮

    constructor(ctx: AgoraExtAppContext, handle: AgoraExtAppHandle) {
        this.context = ctx
        this.handle = handle
        this.onReceivedProps(ctx.properties || {}, null)
    }

    @action
    updateTime = () => {
        if (this.status === 'config') {
            this.currentTime = ''
        } else {
            let properties = this.context.properties
            this.currentTime = formatTime(properties.endTime ? Number(properties.endTime) - Number(properties.startTime) : Math.floor(Date.now() / 1000) - Number(properties.startTime))
        }

        if (this.status === 'config' || this.status === 'end' || this.context.properties.endTime) {
            this.timehandle && clearInterval(this.timehandle);
            this.timehandle = null
        } else {
            this.timehandle || (this.timehandle = setInterval(() => {
                this.updateTime()
            }, 1000))
        }
    }

    changeRoomProperties = async ({
        state,
        canChange = true,
        mulChoice = true,
        startTime,
        endTime,
        items,
        answer,
        replyTime,
        commonState
    }: {
        state?: string,//config(老师本地配置),start(开始答题/投票),end(答题/投票结束)
        canChange?: boolean,//是否允许修改(投票为false，答题为true)
        mulChoice?: boolean,//是否多选(答题为true，投票可设置)
        startTime?: string,
        endTime?: string,
        title?: string,
        items?: Array<string>,//可选内容
        answer?: Array<string>,//正确答案(答题用，投票忽略)
        replyTime?: string,
        commonState?: number
    }) => {
        let roomProperties: any = {}
        if (this.context.localUserInfo.roleType === EduRoleTypeEnum.teacher) {
            ['start','end'].includes(state||'') && (roomProperties['state'] = state) && (roomProperties['restart'] = false)
            canChange && (roomProperties['canChange'] = canChange)
            mulChoice && (roomProperties['mulChoice'] = mulChoice)
            startTime && (roomProperties['startTime'] = startTime)
            endTime && (roomProperties['endTime'] = endTime)
            items && (roomProperties['items'] = items)
            answer && (roomProperties['answer'] = answer)
            if (state === "start") {
                roomProperties['students'] = []
                roomProperties['studentNames'] = []
                this.context.userList?.map((user: any) => {
                    if (!(/^guest[0-9]{10}2$/).test(user.uid || '')) {
                        roomProperties['students'].push(user.uid)
                        roomProperties['studentNames'].push(user.name)
                    }
                });
            } else if (state === "updateStudent") {
                if (this.globalContext.rosterUserList) {
                    let students:any = this.context.properties['students'] || []
                    roomProperties['students'] = []
                    roomProperties['studentNames'] = []

                    students.map((student: any,index: number) => {
                        if (getStudentInfo(this.context.properties['student' + student])) {
                            roomProperties['students'].push(student)
                            roomProperties['studentNames'].push(this.context.properties['studentNames'][index])
                        }
                    });

                    this.globalContext.rosterUserList?.map((user: any) => {
                        if (!(/^guest[0-9]{10}2$/).test(user.uid || '') && !roomProperties['students'].includes(user.uid)) {
                            roomProperties['students'].push(user.uid)
                            roomProperties['studentNames'].push(user.name)
                        }
                    }); 
                    if (JSON.stringify(students.slice().sort()) !== JSON.stringify(roomProperties['students'].slice().sort())) {
                        this.context.userList = this.globalContext.rosterUserList
                        console.log(roomProperties);
                    }else{
                        return;
                    }
                }else{
                    return;
                }
            } else if (state === "clear") {
                roomProperties['students'] = []
                roomProperties['studentNames'] = []
                roomProperties['state'] = ''
                roomProperties['canChange'] = true
                roomProperties['mulChoice'] = true
                roomProperties['startTime'] = ''
                roomProperties['endTime'] = ''
                roomProperties['items'] = []
                roomProperties['answer'] = []

                this.changeRoomProperties({ state: 'clearStudent' })
            } else if (state === "clearStudent") {
                let propers: string[] = [];
                let keys = Object.keys(this.context.properties)
                keys.map((ele: string) => {
                    ['answer','canChange','endTime','items','mulChoice','startTime','restart','state','studentNames','students'].includes(ele) || propers.push(ele)
                })
                console.log('clearStudent:',this.context.properties.students,propers,this.context.properties);
                await this.handle.deleteRoomProperties(propers, {})
                return;
            }else if (state === "reset") {
                roomProperties['restart'] = true
            }
            await this.handle.updateRoomProperty(roomProperties, { state: commonState || 0 }, {})
        } else {
            if (this.context.properties.state === "start") {
                roomProperties['student' + this.context.localUserInfo.userUuid] = { startTime: this.context.properties.startTime,replyTime, answer }
                await this.handle.updateRoomProperty(roomProperties, { state: commonState || 0 }, {startTime: this.context.properties.startTime});
            }
        }
    }

    onSubClick = (clear: boolean = false) => {
        if (this.context.localUserInfo.roleType === EduRoleTypeEnum.teacher) {
            if (clear) {
                this.timehandle && clearInterval(this.timehandle);
                this.timehandle = null
                this.changeRoomProperties({ state: 'clear' })
            } else {
                if (this.status === 'config') {
                    let sels: string[] = [];
                    this.selAnswer?.map((sel: string) => {
                        if (this.answer?.includes(sel)) {
                            sels.push(sel)
                        }
                    })
                    //this.changeRoomProperties({ state: 'clearStudent' })//删除属性会引起插件被关闭
                    this.changeRoomProperties({ state: 'start', startTime: (Math.floor(Date.now() / 1000)).toString(), items: this.answer, answer: sels, commonState: 1 })
                } else if (this.status === 'info') {
                    this.changeRoomProperties({ state: 'end', endTime: (Math.floor(Date.now() / 1000)).toString(), commonState: 1 })
                } else {
                    this.changeRoomProperties({ state: 'reset', commonState: 1 })
                    this.changeRoomProperties({ state: 'clear' })
                }
            }
        } else {
            if (this.status === 'answer') {
                if (this.showModifyBtn) {
                    this.toChangeMode()
                }else{
                    this.showModifyBtn = true;
                    this.changeRoomProperties({ replyTime: (Math.floor(Date.now() / 1000)).toString(), answer: this.selAnswer, commonState: 1 })
                }
            }
        }
    }

    @action
    toChangeMode(){
        this.buttonName = 'answer.submit'
        this.showModifyBtn = false
    }

    @action
    onReceivedProps(properties: any, cause: any) {
        this.context.properties = properties
        if (this.context.localUserInfo.roleType === EduRoleTypeEnum.teacher) {
            if (properties.state === 'start' || properties.state === 'end') {
                this.title = ""
                this.answer = [...(properties.items||['A', 'B', 'C', 'D'])]
                this.selAnswer = []
                this.currentTime = formatTime(properties.endTime ? Number(properties.endTime) - Number(properties.startTime) : Math.floor(Date.now() / 1000) - Number(properties.startTime))
                this.students = []
                let answeredNumber = 0;
                let rightNumber = 0;
                properties.students.map((student: string, index: number) => {
                    let info = {
                        'name': properties.studentNames[index],
                        'replyTime': '',
                        'answer': ''
                    }
                    let answer = getStudentInfo(properties['student' + student])
                    if (answer) {
                        ++answeredNumber;
                        info.answer = answer.answer?answer.answer.slice().sort().join(''):'';
                        info.replyTime = formatTime(Number(answer.replyTime) - Number(properties.startTime))
                        if (info.answer === (properties.answer?.join('') || '')) {
                            ++rightNumber
                        }
                    }
                    this.students?.push(info)
                })
                this.answerInfo = { 'number-answered': '' + answeredNumber + '/' + properties.students.length, 'acc': '' + Math.floor(100 * rightNumber / (properties.students.length || 1)) + '%', 'right-key': properties.answer?.join('、') || '', 'my-answer': '' }
                this.status = properties.state === 'end' ? 'end' : 'info'
                this.height = properties.state === 'end' ? 366 : 366
                this.buttonName = properties.state === 'end' ? 'answer.restart' : 'answer.over'
                this.ui = properties.state === 'end' ? ['users', 'infos', 'subs'] : ['users', 'infos', 'subs']
                this.updateTime();
            } else {
                this.title = ""
                this.answer = ['A', 'B', 'C', 'D']
                this.selAnswer = []
                this.currentTime = ''
                this.students = []
                this.status = 'config'
                this.height = 150
                this.buttonName = 'answer.start'
                this.ui = ['sels', 'subs']
            }
        } else {
            if (properties.state === 'start') {
                this.title = ""
                this.answer = [...(properties.items||['A', 'B', 'C', 'D'])]
                this.currentTime = formatTime(properties.endTime ? Number(properties.endTime) - Number(properties.startTime) : Math.floor(Date.now() / 1000) - Number(properties.startTime))
                this.height = (this.answer?.length || 0) > 4 ? 190 : 120
                if (this.status !== 'answer' || this.showModifyBtn) {
                    this.status = 'answer'
                    this.buttonName = !getStudentInfo(properties['student' + this.context.localUserInfo.userUuid]) ? 'answer.submit' : 'answer.change'
                    this.showModifyBtn = getStudentInfo(properties['student' + this.context.localUserInfo.userUuid])
                    this.ui = ['sels', 'subs']
                    this.selAnswer = getStudentInfo(properties['student' + this.context.localUserInfo.userUuid])?.answer || []
                    this.updateTime();
                }
            } else if (properties.state === 'end') {
                this.title = ""
                this.answer = [...properties.answer||['A', 'B', 'C', 'D']]
                this.selAnswer = getStudentInfo(properties['student' + this.context.localUserInfo.userUuid])?.answer || []
                this.currentTime = formatTime(properties.endTime ? Number(properties.endTime) - Number(properties.startTime) : Math.floor(Date.now() / 1000) - Number(properties.startTime))
                this.status = 'info'
                this.height = 120
                this.ui = ['infos']
                this.showModifyBtn = false

                let answeredNumber = 0;
                let rightNumber = 0;
                properties.students.map((student: string, index: number) => {
                    let info = {
                        'name': properties.studentNames[index],
                        'replyTime': '',
                        'answer': ''
                    }
                    let answer = getStudentInfo(properties['student' + student])
                    if (answer) {
                        ++answeredNumber;
                        info.answer = answer.answer?answer.answer.slice().sort().join(''):'';
                        info.replyTime = formatTime(Number(answer.replyTime) - Number(properties.startTime))
                        if (info.answer === (properties.answer?.join('') || '')) {
                            ++rightNumber
                        }
                    }
                })
                this.answerInfo = { 'number-answered': '' + answeredNumber + '/' + properties.students.length, 'acc': '' + Math.floor(100 * rightNumber / (properties.students.length || 1)) + '%', 'right-key': properties.answer?.join('') || '', 'my-answer': this.selAnswer?.join('') || '' }
                this.updateTime();
            } else {
                this.status = 'end'
                this.title = ""
                this.answer = ['A', 'B', 'C', 'D']
                this.selAnswer = []
                this.currentTime = ''
                this.students = []
                this.status = 'config'
                this.height = 120
                this.buttonName = 'answer.submit'
                this.ui = ['infos']
                this.showModifyBtn = false
            }
        }
    }

    @action
    addAnswer() {
        const answer = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
        if (this.answer && this.answer.length < 8) {
            this.answer.push(answer[this.answer.length])
            this.height = this.answer.length > 4 ? 220 : 150
        }
    }

    @action
    subAnswer() {
        if (this.answer && this.answer.length > 2) {
            this.answer.splice(this.answer.length - 1, 1)
            this.height = this.answer.length > 4 ? 220 : 150
        }
    }

    @action
    changeSelAnswer(sel: string) {
        if (this.selAnswer?.includes(sel)) {
            this.selAnswer.splice(this.selAnswer.indexOf(sel), 1);
        } else {
            this.selAnswer?.push(sel)
        }
        if (this.selAnswer) {
            this.selAnswer = this.selAnswer?.slice().sort()
        }
    }

    @action
    updateGlobalContext(state:any) {
        if (this.context.localUserInfo.roleType === EduRoleTypeEnum.teacher) {
            this.globalContext = state
            if (this.status !== 'config' && this.status !== 'end') {
                this.changeRoomProperties({ state: 'updateStudent', commonState: 1 })
            }
        }
    }
}