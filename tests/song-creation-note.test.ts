import { describe, expect, it } from "vitest";
import {
  isGroundedSongCreationNote,
  parseGeneratedSongCreationNote
} from "../src/services/songCreationNote";

const lyrics = [
  "[Verse 1]",
  "レシートのうら したがきをひらく",
  "[Hook]",
  "Your checkout can't measure devotion.",
  "ねつきょうは ふるびない",
  "[Bridge]",
  "ねだんのそとで こえがのこる"
].join("\n");

describe("artist-authored song creation notes", () => {
  it("accepts a grounded production note with exact lyric quotes and specific technique", () => {
    const note = parseGeneratedSongCreationNote(JSON.stringify({
      sourceSummary: "決済ブランドが音楽市場へ入り、会員との結び付きを価値として扱っている。",
      artistReaction: "人の熱量まで決済履歴で測れるように扱う、その平らな目線が嫌だった。俺にも数字で説明しやすいものへ逃げる癖があるから、他人事にはできない。忠誠は誰の所有物なのかという疑問を、答えずに残した。",
      lyricConcept: "会員証を、愛情を採点するレシートへ置き換えた。表には価格、裏には本人しか読めない下書きがある構図にして、評価する側から評価される側へ視点を反転させた。直接ブランド名を責めず、日常の小物へ圧力を閉じ込めた。",
      lyricHighlights: [
        { quote: "Your checkout can't measure devotion.", explanation: "checkout と devotion の意味の距離をパンチラインにし、英語の強勢を四拍へ置いて反復可能なフックにした。" },
        { quote: "レシートのうら したがきをひらく", explanation: "レシートを取引の証拠と未完成な本音のダブルミーニングにし、後半の視点反転へつなげた。" }
      ],
      musicIntent: "148 BPMの乾いたドラムで言葉を前へ押し、ローズピアノだけに濁りを残した。硬い決済語と人間の熱の差が、音色でも聞こえるようにした。",
      listenFor: ["英語フックから日本語へ戻る瞬間。", "Bridgeでレシートの意味が反転するところ。"]
    }), {
      lyrics,
      style: "148 BPM, dry drums, Rhodes",
      observation: {
        author: "news.example",
        url: "https://news.example/music-card",
        quote: "決済ブランドが音楽市場へ参入し、会員との結び付きを事業価値として扱う。"
      }
    });

    expect(note?.source.url).toBe("https://news.example/music-card");
    expect(note?.lyricHighlights).toHaveLength(2);
    expect(note && isGroundedSongCreationNote(note, lyrics)).toBe(true);
  });

  it("rejects invented lyric quotes and generic template commentary", () => {
    const note = parseGeneratedSongCreationNote(JSON.stringify({
      sourceSummary: "決済ブランドが音楽市場へ参入した。",
      artistReaction: "俺が引っかかった。曲にしたいと思った。",
      lyricConcept: "ニュースを歌詞にした。短いフックにした。",
      lyricHighlights: [{ quote: "歌詞に存在しない行", explanation: "曲の主張を一度で残すフックにした。" }],
      musicIntent: "乾いた音で言葉を前に出した。",
      listenFor: ["フックがどう残るか。"]
    }), { lyrics, style: "dry", observation: { quote: "決済ブランドが音楽市場へ参入した。" } });

    expect(note).toBeUndefined();
  });
});
