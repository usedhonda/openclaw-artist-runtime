// Inline button labels for Telegram notifications.
//
// Public-plugin policy (v10.27): labels are plain JA action verbs paired
// with the concrete target (file name / module). No artist voice / persona
// here — voice belongs in the message body. Third-party plugin users must
// be able to read a label and immediately know which action runs.
export const buttonVoiceLabels = {
  songCompletion: {
    write: "SONGBOOK.md に追記",
    later: "保留",
    archive: "採用して次の曲へ",
    discard: "破棄して次の曲へ",
    xPrepare: "X 草案を作る"
  },
  distribution: {
    apply: "配信記録に反映",
    later: "保留"
  },
  dailyVoice: {
    publish: "投稿",
    edit: "編集",
    cancel: "キャンセル"
  },
  songSpawn: {
    inject: "進める",
    skip: "保留する",
    edit: "修正する"
  },
  promptPackReady: {
    go: "Suno 生成へ",
    edit: "lyrics-suno.md を編集",
    skip: "保留"
  },
  planningSkeleton: {
    apply: "進める",
    skip: "中止",
    edit: "書き直す"
  },
  takeSelect: {
    accept: "採用",
    regenerate: "再生成",
    skip: "保留"
  }
} as const;
