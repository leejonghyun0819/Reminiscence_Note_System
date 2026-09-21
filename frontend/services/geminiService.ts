export interface InterviewQuestionItem {
    id: string;
    category: string;
    targetClue?: string;
    question: string;
    quickOptions?: string[];
}

export interface InterviewResponseData {
    estimatedEra: string;
    sceneFacts: string;
    visualClues: string[];
    interviewQuestions: InterviewQuestionItem[];
}

export interface CuratedNoteData {
    title: string;
    sceneDescription: string;
    remembered: string;
    unremembered: string;
    reflection: string;
}

const BASE_URL = 'http://localhost:8000';

// 1. 여행 모드 멀티모달 분석
export async function analyzeMultiImageMemoryWithGemini(
    images: Array<{ base64: string; mimeType: string }>,
    audio?: { base64: string; mimeType?: string },
): Promise<any> {
    const response = await fetch(`${BASE_URL}/api/gemini/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            images,
            audio_base64: audio?.base64 || null,
            audio_mime: audio?.mimeType || null,
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || '멀티모달 분석에 실패했습니다.');
    }

    const data = await response.json();
    return data.analysis;
}

// 2. 신규 사진 대상 인터뷰 질문 추출
export async function generateMemoryInterview(
    images: Array<{ base64: string; mimeType: string }>,
): Promise<InterviewResponseData> {
    const response = await fetch(`${BASE_URL}/api/gemini/interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || '인터뷰 질문을 생성하지 못했습니다.');
    }

    return await response.json();
}

// 3. 🌟 과거 앨범 대상 인터뷰 질문 추출 (앨범 ID 및 이미지 URL 전달)
export async function generateInterviewFromExistingAlbum(
    memoryId: string,
    imageUrls?: string[],
): Promise<InterviewResponseData> {
    const response = await fetch(`${BASE_URL}/api/gemini/interview-from-album`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            memoryId,
            imageUrls: imageUrls || [],
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || '과거 사진 분석에 실패했습니다.');
    }

    return await response.json();
}

// 4. 단서와 Q&A 결합 4단계 큐레이션 노트 합성
export async function buildCuratedMemoryNote(
    factsAndClues: { estimatedEra?: string; sceneFacts?: string; visualClues?: string[] },
    qaPairs: Array<{ id: string; category?: string; question: string; answer: string }>,
): Promise<CuratedNoteData> {
    const response = await fetch(`${BASE_URL}/api/gemini/curate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            factsAndClues,
            qaPairs,
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || '큐레이션 노트 합성에 실패했습니다.');
    }

    return await response.json();
}

// frontend/services/geminiService.ts에 추가
export async function detectMemoryMode(
    images: Array<{ base64: string; mimeType: string }>,
): Promise<'childhood' | 'travel'> {
    const response = await fetch(`${BASE_URL}/api/gemini/detect-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
    });

    if (!response.ok) {
        return 'travel';
    }

    const data = await response.json();
    return data.mode || 'travel';
}
