export interface StepfunTtsModelOption {
  id: string
  label: string
  hint: string
  /** 只有 stepaudio-2.5-tts 支持自然语言 instruction */
  supportsInstruction: boolean
}

export interface StepfunTtsVoiceOption {
  id: string
  label: string
  language: string
  gender: string
  hint: string
}

export const STEPFUN_TTS_DOC_URL = 'https://platform.stepfun.com/docs/zh/step-plan/integrations/audio-api'

export const STEPFUN_TTS_BASE_URL = 'https://api.stepfun.com/v1'
/** Step Plan 套餐走独立路径前缀 */
export const STEPFUN_TTS_STEP_PLAN_BASE_URL = 'https://api.stepfun.com/step_plan/v1'

export const STEPFUN_TTS_MODELS: StepfunTtsModelOption[] = [
  {
    id: 'stepaudio-2.5-tts',
    label: 'StepAudio 2.5 TTS',
    hint: '基于语境理解的 Contextual TTS，支持 instruction 自然语言控制语气与情绪。',
    supportsInstruction: true,
  },
  {
    id: 'step-tts-2',
    label: 'Step TTS 2',
    hint: '通用语音合成模型，不支持 instruction 风格指令。',
    supportsInstruction: false,
  },
  {
    id: 'step-tts-mini',
    label: 'Step TTS Mini',
    hint: '轻量语音合成模型，成本更低，不支持 instruction 风格指令。',
    supportsInstruction: false,
  },
]

export const STEPFUN_TTS_VOICES: StepfunTtsVoiceOption[] = [
  { id: 'linjiajiejie', label: '邻家姐姐', language: '中文', gender: '女', hint: '口播、情感陪伴、语音助手、视频配音' },
  { id: 'linjiameimei', label: '邻家妹妹', language: '中文', gender: '女', hint: '视频配音、口播、语音助手' },
  { id: 'zhixingjiejie', label: '知性姐姐', language: '中文', gender: '女', hint: '视频配音、口播、语音助手' },
  { id: 'wenrounvsheng', label: '温柔女声', language: '中文', gender: '女', hint: '有声书、情感陪伴' },
  { id: 'tianmeinvsheng', label: '甜美女声', language: '中文', gender: '女', hint: '情感陪伴、客服与业务办理' },
  { id: 'qingchunshaonv', label: '清纯少女', language: '中文', gender: '女', hint: '客服与业务办理、语音助手' },
  { id: 'yuanqishaonv', label: '元气少女', language: '中文', gender: '女', hint: '有声书、情感陪伴、语音助手' },
  { id: 'jilingshaonv', label: '机灵少女', language: '中文', gender: '女', hint: '语音助手、口播' },
  { id: 'ruanmengnvsheng', label: '软萌女声', language: '中文', gender: '女', hint: '情感陪伴、语音助手、视频配音' },
  { id: 'youyanvsheng', label: '优雅女声', language: '中文', gender: '女', hint: '视频配音' },
  { id: 'lengyanyujie', label: '冷艳御姐', language: '中文', gender: '女', hint: '视频配音' },
  { id: 'shuangkuaijiejie', label: '爽快姐姐', language: '中文', gender: '女', hint: '口播' },
  { id: 'wenjingxuejie', label: '文静学姐', language: '中文', gender: '女', hint: '口播' },
  { id: 'wenroushunv', label: '温柔熟女', language: '中文', gender: '女', hint: '客服与业务办理、口播、教育与培训' },
  { id: 'jingdiannvsheng', label: '经典女声', language: '中文', gender: '女', hint: '客服与业务办理、情感陪伴' },
  { id: 'qinqienvsheng', label: '亲切女声', language: '中文', gender: '女', hint: '口播' },
  { id: 'qinhenvsheng', label: '亲和女声', language: '中文', gender: '女', hint: '客服与业务办理、语音助手' },
  { id: 'ganliannvsheng', label: '干练女声', language: '中文', gender: '女', hint: '客服与业务办理、语音助手' },
  { id: 'huolinvsheng', label: '活力女声', language: '中文', gender: '女', hint: '客服与业务办理、语音助手' },
  { id: 'elegantgentle-female', label: '气质温婉', language: '中文', gender: '女', hint: '客服与业务办理、口播、教育与培训、情感陪伴' },
  { id: 'livelybreezy-female', label: '活力轻快', language: '中文', gender: '女', hint: '情感陪伴、客服与业务办理、教育与培训、营销' },
  { id: 'lively-girl', label: 'Lively Girl', language: '中文', gender: '女', hint: '有声书、视频配音' },
  { id: 'cixingnansheng', label: '磁性男声', language: '中文', gender: '男', hint: '有声书、情感陪伴' },
  { id: 'wenrounansheng', label: '温柔男声', language: '中文', gender: '男', hint: '口播、情感陪伴、客服与业务办理、教育与培训' },
  { id: 'wenrougongzi', label: '温柔公子', language: '中文', gender: '男', hint: '情感陪伴、有声书' },
  { id: 'zixinnansheng', label: '自信男声', language: '中文', gender: '男', hint: '有声书、情感陪伴、教育与培训、营销' },
  { id: 'yuanqinansheng', label: '元气男声', language: '中文', gender: '男', hint: '有声书、口播、客服与业务办理' },
  { id: 'shuangkuainansheng', label: '爽快男声', language: '中文', gender: '男', hint: '客服与业务办理、语音助手' },
  { id: 'zhengpaiqingnian', label: '正派青年', language: '中文', gender: '男', hint: '营销、有声书' },
  { id: 'qingniandaxuesheng', label: '青年大学生', language: '中文', gender: '男', hint: '口播' },
  { id: 'boyinnansheng', label: '播音男声', language: '中文', gender: '男', hint: '有声书、口播' },
  { id: 'ruyananshi', label: '儒雅男士', language: '中文', gender: '男', hint: '有声书、情感陪伴、口播、语音助手' },
  { id: 'shenchennanyin', label: '深沉男音', language: '中文', gender: '男', hint: '情感陪伴、有声书' },
  { id: 'vibrant-youth', label: 'Vibrant Youth', language: '中文', gender: '男', hint: '有声书、视频配音' },
  { id: 'soft-spoken-gentleman', label: 'Soft-spoken Gentleman', language: '中文', gender: '男', hint: '情感陪伴、有声书' },
  { id: 'magnetic-voiced-male', label: 'Magnetic-voiced Male', language: '中文', gender: '男', hint: '有声书、视频配音' },
]

export const STEPFUN_DEFAULT_TTS = {
  baseURL: STEPFUN_TTS_BASE_URL,
  model: 'stepaudio-2.5-tts',
  voice: 'linjiajiejie',
} as const

export function findStepfunTtsModel(model: string): StepfunTtsModelOption | undefined {
  return STEPFUN_TTS_MODELS.find((item) => item.id === String(model || '').trim())
}

export function findStepfunTtsVoice(voice: string): StepfunTtsVoiceOption | undefined {
  return STEPFUN_TTS_VOICES.find((item) => item.id === String(voice || '').trim())
}
