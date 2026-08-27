// frontend/features/enhance/EnhanceCompareViewer.tsx
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';

interface EnhanceCompareViewerProps {
    currentImageUrl: string;
    enhancedResultUrl: string;
    onKeepOriginal: () => void;
    onApplyEnhanced: () => void;
    onKeepBoth: () => void;
}

export const EnhanceCompareViewer: React.FC<EnhanceCompareViewerProps> = ({
    currentImageUrl,
    enhancedResultUrl,
    onKeepOriginal,
    onApplyEnhanced,
    onKeepBoth,
}) => {
    return (
        <View style={styles.compareContainer}>
            <Text style={styles.compareNotice}>
                🔍 YouCam AI 개선이 완료되었습니다! 원본 교체 또는 두 장 모두 보관 중 원하는 방식을 선택하세요.
            </Text>

            <View style={styles.compareRow}>
                {/* 좌: 현재 원본 사진 */}
                <View style={styles.compareCol}>
                    <View style={styles.compareHeader}>
                        <Text style={styles.compareTagOriginal}>📷 현재 원본 사진</Text>
                    </View>
                    <View style={styles.imagePreviewBox}>
                        <Image source={{ uri: currentImageUrl }} style={styles.previewImg} resizeMode="contain" />
                    </View>
                    <TouchableOpacity style={styles.chooseOriginalBtn} onPress={onKeepOriginal}>
                        <Text style={styles.chooseOriginalBtnText}>원본만 유지 (취소)</Text>
                    </TouchableOpacity>
                </View>

                {/* 우: 새로 생성된 YouCam AI 개선본 */}
                <View style={styles.compareCol}>
                    <View style={styles.compareHeader}>
                        <Text style={styles.compareTagEnhanced}>✨ YouCam AI 개선본</Text>
                    </View>
                    <View style={styles.imagePreviewBox}>
                        <Image source={{ uri: enhancedResultUrl }} style={styles.previewImg} resizeMode="contain" />
                    </View>
                    <View style={styles.enhancedActionCol}>
                        <TouchableOpacity style={styles.chooseEnhancedBtn} onPress={onApplyEnhanced}>
                            <Text style={styles.chooseEnhancedBtnText}>✨ 개선본으로 교체하기</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.keepBothBtn} onPress={onKeepBoth}>
                            <Text style={styles.keepBothBtnText}>➕ 원본과 개선본 둘 다 보관</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    compareContainer: { width: '100%' },
    compareNotice: {
        fontSize: 14,
        fontWeight: '600',
        color: '#4F46E5',
        backgroundColor: '#EEF2FF',
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
        textAlign: 'center',
    },
    compareRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
    compareCol: { flex: 1, minWidth: 280 },
    compareHeader: { marginBottom: 8, alignItems: 'center' },
    compareTagOriginal: {
        fontSize: 13,
        fontWeight: '700',
        color: '#475569',
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
    },
    compareTagEnhanced: {
        fontSize: 13,
        fontWeight: '700',
        color: '#4F46E5',
        backgroundColor: '#EEF2FF',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
    },
    imagePreviewBox: {
        width: '100%',
        height: 300,
        backgroundColor: '#0F172A',
        borderRadius: 10,
        overflow: 'hidden',
        marginBottom: 12,
    },
    previewImg: { width: '100%', height: '100%' },
    chooseOriginalBtn: {
        backgroundColor: '#F1F5F9',
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    chooseOriginalBtnText: { color: '#475569', fontSize: 13, fontWeight: '700' },
    enhancedActionCol: { gap: 8 },
    chooseEnhancedBtn: {
        backgroundColor: '#4F46E5',
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    chooseEnhancedBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    keepBothBtn: {
        backgroundColor: '#059669',
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    keepBothBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
