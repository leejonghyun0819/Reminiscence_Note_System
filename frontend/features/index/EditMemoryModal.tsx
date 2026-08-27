// frontend/features/index/EditMemoryModal.tsx
import React, { useState, useEffect } from 'react';
import {
    Modal,
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { useMemory, MemoryItem, AnalysisVersion } from '../../context/MemoryContext';

export interface EditMemoryModalProps {
    visible?: boolean;
    isOpen?: boolean;
    item?: MemoryItem | null;
    memory?: MemoryItem | null;
    onClose: () => void;
    onSave?: (updatedItem: MemoryItem) => void;
}

export const EditMemoryModal: React.FC<EditMemoryModalProps> = ({ visible, isOpen, item, memory, onClose }) => {
    const { updateMemoryItem, deleteHistoryVersion } = useMemory();

    // item 또는 memory props 모두 호환
    const targetMemory = item || memory || null;
    const isModalVisible = visible !== undefined ? visible : Boolean(isOpen);

    const [title, setTitle] = useState('');
    const [location, setLocation] = useState('');
    const [yearEstimate, setYearEstimate] = useState('');
    const [description, setDescription] = useState('');
    const [storyCaption, setStoryCaption] = useState('');
    const [categoryFolder, setCategoryFolder] = useState('미분류');

    const [history, setHistory] = useState<AnalysisVersion[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (targetMemory) {
            setTitle(targetMemory.analysis?.title || '');
            setLocation(targetMemory.analysis?.location || '');
            setYearEstimate(targetMemory.analysis?.yearEstimate || '');
            setDescription(targetMemory.analysis?.description || '');
            setStoryCaption(targetMemory.analysis?.storyCaption || '');
            setCategoryFolder(targetMemory.categoryFolder || '미분류');
            setHistory(targetMemory.history || []);
        }
    }, [targetMemory, isModalVisible]);

    if (!targetMemory) return null;

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const updates = {
                title,
                location,
                yearEstimate,
                description,
                storyCaption,
                categoryFolder,
            };

            const result = await updateMemoryItem(targetMemory.id, updates);

            if (Array.isArray(result) && result.length > 0) {
                setHistory(result);
            }

            alert('성공적으로 수정되었습니다.');
            onClose();
        } catch (e: any) {
            alert(`수정 중 오류가 발생했습니다: ${e.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleRestoreVersion = (ver: AnalysisVersion) => {
        setTitle(ver.title || '');
        setLocation(ver.location || '');
        setYearEstimate(ver.yearEstimate || '');
        setDescription(ver.description || '');
        setStoryCaption(ver.storyCaption || '');
        alert(`버전 ${ver.version}의 내용으로 입력창에 복원했습니다. '저장하기'를 누르면 적용됩니다.`);
    };

    const handleDeleteVersion = async (versionNum: number) => {
        try {
            await deleteHistoryVersion(targetMemory.id, versionNum);
            setHistory((prev) => prev.filter((v) => v.version !== versionNum));
        } catch (e: any) {
            alert(`히스토리 삭제 실패: ${e.message}`);
        }
    };

    return (
        <Modal visible={isModalVisible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <View style={styles.modalContainer}>
                    <View style={styles.header}>
                        <Text style={styles.headerTitle}>✏️ 추억 내용 편집 & 버전 관리</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                            <Text style={styles.closeBtnText}>✕</Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                        {/* 기본 필드 수정 */}
                        <Text style={styles.label}>앨범 제목</Text>
                        <TextInput
                            style={styles.input}
                            value={title}
                            onChangeText={setTitle}
                            placeholder="앨범 제목을 입력하세요"
                        />

                        <View style={styles.rowInputs}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.label}>장소</Text>
                                <TextInput
                                    style={styles.input}
                                    value={location}
                                    onChangeText={setLocation}
                                    placeholder="예: 제주도 협재해변"
                                />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.label}>추정 시기</Text>
                                <TextInput
                                    style={styles.input}
                                    value={yearEstimate}
                                    onChangeText={setYearEstimate}
                                    placeholder="예: 2018년 여름"
                                />
                            </View>
                        </View>

                        <Text style={styles.label}>상황 요약</Text>
                        <TextInput
                            style={[styles.input, styles.textArea]}
                            value={description}
                            onChangeText={setDescription}
                            placeholder="상황 요약을 입력하세요"
                            multiline
                            numberOfLines={3}
                        />

                        <Text style={styles.label}>감성 에세이 / 스토리 캡션</Text>
                        <TextInput
                            style={[styles.input, styles.textAreaLarge]}
                            value={storyCaption}
                            onChangeText={setStoryCaption}
                            placeholder="추억 에세이를 입력하세요"
                            multiline
                            numberOfLines={6}
                        />

                        {/* 변경 이력 (히스토리) */}
                        {history.length > 0 && (
                            <View style={styles.historySection}>
                                <Text style={styles.historySectionTitle}>📜 변경 버전 기록 ({history.length}개)</Text>
                                {history.map((ver, idx) => (
                                    <View key={idx} style={styles.historyCard}>
                                        <View style={styles.historyCardHeader}>
                                            <Text style={styles.historyVerBadge}>Ver {ver.version}</Text>
                                            <Text style={styles.historyDate}>
                                                {new Date(ver.timestamp).toLocaleString()}
                                            </Text>
                                            <View style={{ flex: 1 }} />
                                            <TouchableOpacity
                                                style={styles.restoreBtn}
                                                onPress={() => handleRestoreVersion(ver)}
                                            >
                                                <Text style={styles.restoreBtnText}>이 버전으로 복원</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={styles.deleteVerBtn}
                                                onPress={() => handleDeleteVersion(ver.version)}
                                            >
                                                <Text style={styles.deleteVerBtnText}>삭제</Text>
                                            </TouchableOpacity>
                                        </View>
                                        <Text style={styles.historyTitleText}>제목: {ver.title}</Text>
                                        <Text style={styles.historyDescText} numberOfLines={2}>
                                            {ver.description}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        )}
                    </ScrollView>

                    <View style={styles.footer}>
                        <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={isSaving}>
                            <Text style={styles.cancelBtnText}>취소</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={isSaving}>
                            {isSaving ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                                <Text style={styles.saveBtnText}>저장하기</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContainer: {
        width: '100%',
        maxWidth: 720,
        maxHeight: '90%',
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 15,
        elevation: 5,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 18,
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
    },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
    closeBtn: { padding: 6 },
    closeBtnText: { fontSize: 18, color: '#64748B', fontWeight: '700' },
    body: { flex: 1, paddingHorizontal: 24 },
    bodyContent: { paddingVertical: 20, gap: 12 },
    label: { fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: -4 },
    input: {
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
        color: '#0F172A',
        backgroundColor: '#F8FAFC',
    },
    rowInputs: { flexDirection: 'row', gap: 12 },
    textArea: { minHeight: 70, textAlignVertical: 'top' },
    textAreaLarge: { minHeight: 120, textAlignVertical: 'top' },
    historySection: {
        marginTop: 20,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
        gap: 10,
    },
    historySectionTitle: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
    historyCard: {
        backgroundColor: '#F1F5F9',
        borderRadius: 8,
        padding: 12,
        gap: 6,
    },
    historyCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    historyVerBadge: {
        backgroundColor: '#6366F1',
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '700',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    historyDate: { fontSize: 11, color: '#64748B' },
    restoreBtn: {
        backgroundColor: '#EEF2FF',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
    },
    restoreBtnText: { fontSize: 11, color: '#4F46E5', fontWeight: '700' },
    deleteVerBtn: {
        backgroundColor: '#FEE2E2',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
    },
    deleteVerBtnText: { fontSize: 11, color: '#EF4444', fontWeight: '700' },
    historyTitleText: { fontSize: 13, fontWeight: '600', color: '#1E293B' },
    historyDescText: { fontSize: 12, color: '#64748B' },
    footer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 12,
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
        backgroundColor: '#F8FAFC',
    },
    cancelBtn: {
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        backgroundColor: '#E2E8F0',
    },
    cancelBtnText: { fontSize: 14, fontWeight: '600', color: '#475569' },
    saveBtn: {
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 8,
        backgroundColor: '#4F46E5',
        minWidth: 90,
        alignItems: 'center',
    },
    saveBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
