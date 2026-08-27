// frontend/services/geminiService.ts
const BACKEND_URL = 'http://localhost:8000';

export interface AnalysisResult {
    title: string;
    location: string;
    yearEstimate: string;
    description: string;
    storyCaption: string;
    audioTranscriptSummary?: string;
}

export type GeminiAnalysisResult = AnalysisResult;

export type MediaInput = string | { base64?: string; uri?: string; mimeType?: string; type?: string };

function normalizeMediaItem(item: MediaInput, defaultMime: string = 'image/jpeg') {
    if (typeof item === 'string') {
        return { base64: item, mimeType: defaultMime };
    }
    return {
        base64: item.base64 || item.uri || '',
        mimeType: item.mimeType || item.type || defaultMime,
    };
}

/**
 * 다중 이미지 및 오디오 멀티모달 분석
 */
export async function analyzeMultiImageMemoryWithGemini(
    images: any[],
    arg2?: any,
    arg3?: any,
    arg4?: any,
): Promise<AnalysisResult> {
    try {
        const formattedImages = (images || []).map((img) => normalizeMediaItem(img, 'image/jpeg'));

        let audioPayload: { base64: string; mimeType: string } | null = null;
        let userComment = '';

        // index.tsx 호출 시그니처 대응: (images, audioBase64, audioMimeType)
        if (typeof arg2 === 'string' && arg2.length > 0) {
            const mime = typeof arg3 === 'string' && arg3.includes('audio') ? arg3 : 'audio/mp3';
            audioPayload = { base64: arg2, mimeType: mime };
            userComment = typeof arg4 === 'string' ? arg4 : '';
        } else if (typeof arg2 === 'object' && arg2 !== null) {
            audioPayload = normalizeMediaItem(arg2, 'audio/mp3');
            userComment = typeof arg3 === 'string' ? arg3 : '';
        } else if (typeof arg3 === 'string' && !arg3.includes('audio')) {
            userComment = arg3;
        }

        const res = await fetch(`${BACKEND_URL}/api/gemini/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                images: formattedImages,
                audio: audioPayload,
                userComment: userComment || '',
            }),
        });

        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.detail || `AI 서버 응답 오류 (HTTP ${res.status})`);
        }

        const data = await res.json();
        const result = data.analysis || data;

        return {
            title: result.title || '추억의 순간',
            location: result.location || '장소 미상',
            yearEstimate: result.yearEstimate || result.year_estimate || '시기 미상',
            description: result.description || '',
            storyCaption: result.storyCaption || '',
            audioTranscriptSummary: result.audioTranscriptSummary || '',
        };
    } catch (error: any) {
        console.error('Gemini 멀티모달 분석 실패:', error);
        throw error;
    }
}

/**
 * AI 재분석 (사용자 코멘트 반영)
 */
export async function refineMemoryWithGemini(
    currentAnalysis: Partial<AnalysisResult>,
    userComment: string,
    images?: any[],
    audioData?: any,
): Promise<AnalysisResult> {
    const combinedComment = `[기존 분석 데이터]\n제목: ${currentAnalysis.title || ''}\n장소: ${
        currentAnalysis.location || ''
    }\n시기: ${currentAnalysis.yearEstimate || ''}\n설명: ${
        currentAnalysis.description || ''
    }\n\n[사용자 추가 회상 요청]: ${userComment}`;

    return analyzeMultiImageMemoryWithGemini(images || [], audioData || null, combinedComment);
}

export const analyzeSingleMemoryWithGemini = analyzeMultiImageMemoryWithGemini;
