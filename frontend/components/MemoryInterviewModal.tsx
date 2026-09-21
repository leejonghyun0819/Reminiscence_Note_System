// frontend/components/MemoryInterviewModal.tsx
import React, { useState, useEffect } from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    TextInput,
    ActivityIndicator,
} from 'react-native';
import { CuratedNoteData, buildCuratedMemoryNote } from '../services/geminiService';

interface InterviewQuestion {
    id: string;
    category: string;
    targetClue?: string;
    question: string;
    quickOptions?: string[];
}

interface FactsAndClues {
    estimatedEra?: string;
    sceneFacts?: string;
    visualClues?: string[];
}

interface MemoryInterviewModalProps {
    visible: boolean;
    onClose: () => void;
    factsAndClues: FactsAndClues;
    questions: InterviewQuestion[];
    initialAnswers?: Record<string, string>;
    initialExtraStory?: string;
    onComplete: (
        curatedNote: CuratedNoteData,
        qaPairs: Array<{ id: string; question: string; answer: string }>,
        extraStory: string,
    ) => void;
}

export function MemoryInterviewModal({
    visible,
    onClose,
    factsAndClues,
    questions = [],
    initialAnswers = {},
    initialExtraStory = '',
    onComplete,
}: MemoryInterviewModalProps) {
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [extraStory, setExtraStory] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [statusText, setStatusText] = useState<string>('');

    useEffect(() => {
        if (visible) {
            setAnswers(initialAnswers || {});
            setExtraStory(initialExtraStory || '');
            setIsSubmitting(false);
            setStatusText('');
        }
    }, [visible, initialAnswers, initialExtraStory]);

    const handleOptionSelect = (qId: string, option: string) => {
        setAnswers((prev) => ({
            ...prev,
            [qId]: option,
        }));
    };

    const handleTextChange = (qId: string, text: string) => {
        setAnswers((prev) => ({
            ...prev,
            [qId]: text,
        }));
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setStatusText('✍️ 답변을 바탕으로 4단계 추억 노트를 작성 중입니다...');

        try {
            const qaPairs = questions.map((q) => ({
                id: q.id,
                category: q.category,
                question: q.question,
                answer: answers[q.id] || '기억 안 남',
            }));

            if (extraStory.trim()) {
                qaPairs.push({
                    id: 'extra_memory',
                    category: '자유 회상',
                    question: '추가 사연',
                    answer: extraStory.trim(),
                });
            }

            // 🌟 geminiService.ts의 원래 함수명인 buildCuratedMemoryNote 호출
            const curatedNote = await buildCuratedMemoryNote(
                {
                    estimatedEra: factsAndClues.estimatedEra || '시기 미상',
                    sceneFacts: factsAndClues.sceneFacts || '',
                    visualClues: factsAndClues.visualClues || [],
                },
                qaPairs,
            );

            setStatusText('✨ 추억 노트 완성! 적용 중...');
            onComplete(curatedNote, qaPairs, extraStory);
        } catch (e: any) {
            alert(`재분석 중 오류 발생: ${e.message || e}`);
        } finally {
            setIsSubmitting(false);
            setStatusText('');
        }
    };

    if (!visible) return null;

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <View style={styles.container}>
                    {/* 상단 헤더 */}
                    <View style={styles.header}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.headerTitle}>💡 기억 인터뷰 및 재분석</Text>
                            <Text style={styles.headerSubtitle}>
                                기존 답변을 수정하거나 새로운 기억을 덧붙여 노트를 다시 작성할 수 있습니다.
                            </Text>
                        </View>
                        <TouchableOpacity style={styles.closeBtn} onPress={onClose} disabled={isSubmitting}>
                            <Text style={styles.closeBtnText}>✕</Text>
                        </TouchableOpacity>
                    </View>

                    {/* 질문 목록 영역 */}
                    <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
                        {questions.map((q, idx) => {
                            const currentAns = answers[q.id] || '';
                            return (
                                <View key={q.id || idx} style={styles.questionBlock}>
                                    <View style={styles.categoryBadge}>
                                        <Text style={styles.categoryBadgeText}>{q.category || '기억의 단서'}</Text>
                                    </View>

                                    <Text style={styles.questionText}>{`${idx + 1}. ${q.question}`}</Text>

                                    {/* 빠른 선택 옵션 칩 */}
                                    {q.quickOptions && q.quickOptions.length > 0 && (
                                        <View style={styles.optionsRow}>
                                            {q.quickOptions.map((opt, optIdx) => {
                                                const isSelected = currentAns === opt;
                                                return (
                                                    <TouchableOpacity
                                                        key={optIdx}
                                                        style={[
                                                            styles.optionChip,
                                                            isSelected && styles.optionChipActive,
                                                        ]}
                                                        onPress={() => handleOptionSelect(q.id, opt)}
                                                        disabled={isSubmitting}
                                                    >
                                                        <Text
                                                            style={[
                                                                styles.optionChipText,
                                                                isSelected && styles.optionChipTextActive,
                                                            ]}
                                                        >
                                                            {opt}
                                                        </Text>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </View>
                                    )}

                                    {/* 주관식 직접 입력창 */}
                                    <TextInput
                                        style={styles.input}
                                        placeholder="직접 입력 (예: 골목길, 노란 장난감...)"
                                        placeholderTextColor="#94A3B8"
                                        value={answers[q.id] || ''}
                                        onChangeText={(txt) => handleTextChange(q.id, txt)}
                                        editable={!isSubmitting}
                                    />
                                </View>
                            );
                        })}

                        {/* 자유 추가 회상 */}
                        <View style={styles.questionBlock}>
                            <View style={[styles.categoryBadge, { backgroundColor: '#FEF3C7' }]}>
                                <Text style={[styles.categoryBadgeText, { color: '#B45309' }]}>자유 회상</Text>
                            </View>

                            <Text style={styles.questionText}>
                                {`${(questions?.length || 0) + 1}. 그 외에 떠오르는 사연이나 꼭 남기고 싶은 이야기가 있다면 자유롭게 적어주세요.`}
                            </Text>

                            <TextInput
                                style={[styles.input, styles.multilineInput]}
                                placeholder="예: 이 사진 찍고 나서 다 같이 중국집에 갔던 기억이 나요..."
                                placeholderTextColor="#94A3B8"
                                value={extraStory}
                                onChangeText={setExtraStory}
                                multiline
                                editable={!isSubmitting}
                            />
                        </View>
                    </ScrollView>

                    {/* 하단 액션 버튼 바 및 진행 상태 */}
                    <View style={styles.footer}>
                        {isSubmitting && (
                            <View style={styles.statusRow}>
                                <ActivityIndicator size="small" color="#0284C7" />
                                <Text style={styles.statusText}>{statusText}</Text>
                            </View>
                        )}

                        <View style={styles.btnRow}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={isSubmitting}>
                                <Text style={styles.cancelBtnText}>닫기</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
                                onPress={handleSubmit}
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? (
                                    <View style={styles.loadingInner}>
                                        <ActivityIndicator size="small" color="#FFFFFF" />
                                        <Text style={styles.submitBtnText}>분석 합성 중...</Text>
                                    </View>
                                ) : (
                                    <Text style={styles.submitBtnText}>✨ 인터뷰 반영 & 재분석</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    container: {
        width: '100%',
        maxWidth: 680,
        height: '88%',
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        borderBottomWidth: 1,
        borderColor: '#E2E8F0',
        paddingBottom: 14,
        marginBottom: 16,
    },
    headerTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
    headerSubtitle: { fontSize: 12, color: '#64748B', marginTop: 4 },
    closeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
    },
    closeBtnText: { fontSize: 14, fontWeight: '800', color: '#64748B' },
    body: { flex: 1, paddingRight: 4 },
    questionBlock: {
        marginBottom: 20,
        backgroundColor: '#F8FAFC',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    categoryBadge: {
        alignSelf: 'flex-start',
        backgroundColor: '#E0F2FE',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        marginBottom: 8,
    },
    categoryBadgeText: { fontSize: 11, fontWeight: '700', color: '#0369A1' },
    questionText: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginBottom: 12 },
    optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    optionChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#CBD5E1',
    },
    optionChipActive: {
        backgroundColor: '#0284C7',
        borderColor: '#0284C7',
    },
    optionChipText: { fontSize: 12, color: '#475569', fontWeight: '600' },
    optionChipTextActive: { color: '#FFFFFF', fontWeight: '700' },
    input: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 9,
        fontSize: 13,
        color: '#0F172A',
    },
    multilineInput: { height: 80, textAlignVertical: 'top' },
    footer: {
        borderTopWidth: 1,
        borderColor: '#E2E8F0',
        paddingTop: 14,
        marginTop: 10,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginBottom: 10,
        backgroundColor: '#F0F9FF',
        paddingVertical: 6,
        borderRadius: 6,
    },
    statusText: { fontSize: 12, fontWeight: '700', color: '#0369A1' },
    btnRow: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 10,
        alignItems: 'center',
    },
    cancelBtn: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: '#F1F5F9',
    },
    cancelBtnText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
    submitBtn: {
        backgroundColor: '#0284C7',
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 8,
        minWidth: 150,
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitBtnDisabled: {
        backgroundColor: '#7DD3FC',
    },
    submitBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
    loadingInner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
});
