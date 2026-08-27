// frontend/features/GalleryViewerModal.tsx
import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, Image, StyleSheet, Platform } from 'react-native';
import { MemoryItem } from '../../context/MemoryContext';
import { MouseDragHorizontalScroll } from '../backup/MouseDragHorizontalScroll';
import { isVideoUrl } from '../../utils/mediaProcessUtils';

interface GalleryViewerModalProps {
    item: MemoryItem | null;
    initialIdx?: number;
    onClose: () => void;
}

export const GalleryViewerModal: React.FC<GalleryViewerModalProps> = ({ item, initialIdx = 0, onClose }) => {
    const [activePhotoIdx, setActivePhotoIdx] = useState<number>(initialIdx);

    useEffect(() => {
        setActivePhotoIdx(initialIdx);
    }, [initialIdx, item]);

    useEffect(() => {
        if (Platform.OS !== 'web' || !item) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const total = item.imageUrls.length;
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                setActivePhotoIdx((prev) => (prev + 1 < total ? prev + 1 : 0));
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setActivePhotoIdx((prev) => (prev - 1 >= 0 ? prev - 1 : total - 1));
            } else if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [item, onClose]);

    if (!item) return null;

    return (
        <Modal visible={item !== null} animationType="fade" transparent onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <View>
                            <Text style={styles.modalHeaderTitle}>
                                {`🖼️ 앨범 전체 미디어 갤러리 (${item.imageUrls.length}개)`}
                            </Text>
                            <Text style={styles.modalHeaderSub}>
                                동영상은 컨트롤러를 눌러 시청할 수 있으며, 방향키(←, →)로 다음 미디어로 이동할 수
                                있습니다.
                            </Text>
                        </View>
                        <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
                            <Text style={styles.modalCloseBtnText}>✕</Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.modalBody} contentContainerStyle={{ padding: 24, gap: 16 }}>
                        <View style={styles.galleryMainBox}>
                            <TouchableOpacity
                                style={[styles.navArrowBtn, styles.navArrowBtnLeft]}
                                onPress={() =>
                                    setActivePhotoIdx((prev) => (prev - 1 >= 0 ? prev - 1 : item.imageUrls.length - 1))
                                }
                            >
                                <Text style={styles.navArrowText}>‹</Text>
                            </TouchableOpacity>

                            {isVideoUrl(item.imageUrls[activePhotoIdx]) && Platform.OS === 'web' ? (
                                <div
                                    style={{
                                        width: '100%',
                                        height: 380,
                                        display: 'flex',
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                    }}
                                >
                                    <video
                                        key={item.imageUrls[activePhotoIdx]}
                                        src={item.imageUrls[activePhotoIdx]}
                                        controls
                                        autoPlay
                                        playsInline
                                        style={{
                                            width: '100%',
                                            maxHeight: 380,
                                            borderRadius: 8,
                                            backgroundColor: '#000',
                                        }}
                                    />
                                </div>
                            ) : (
                                <Image
                                    source={{ uri: item.imageUrls[activePhotoIdx] }}
                                    style={styles.galleryMainLargeImg}
                                    resizeMode="contain"
                                />
                            )}

                            <TouchableOpacity
                                style={[styles.navArrowBtn, styles.navArrowBtnRight]}
                                onPress={() =>
                                    setActivePhotoIdx((prev) => (prev + 1 < item.imageUrls.length ? prev + 1 : 0))
                                }
                            >
                                <Text style={styles.navArrowText}>›</Text>
                            </TouchableOpacity>

                            <Text style={styles.galleryIndexIndicator}>
                                {`${isVideoUrl(item.imageUrls[activePhotoIdx]) ? '🎬 동영상 ' : '🖼️ 사진 '} ${activePhotoIdx + 1} / ${item.imageUrls.length}`}
                            </Text>
                        </View>

                        <Text style={styles.formLabel}>전체 미디어 목록 (클릭하여 열람 및 재생)</Text>
                        <MouseDragHorizontalScroll contentContainerStyle={styles.galleryAllThumbsRow}>
                            {item.imageUrls.map((url, gIdx) => {
                                const isVid = isVideoUrl(url);
                                return (
                                    <TouchableOpacity
                                        key={gIdx}
                                        onPress={() => setActivePhotoIdx(gIdx)}
                                        style={[
                                            styles.galleryThumbItem,
                                            activePhotoIdx === gIdx && styles.galleryThumbItemActive,
                                        ]}
                                    >
                                        {isVid && Platform.OS === 'web' ? (
                                            <div
                                                style={{
                                                    width: '100%',
                                                    height: '100%',
                                                    position: 'relative',
                                                    backgroundColor: '#000',
                                                }}
                                            >
                                                <video
                                                    src={url}
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                    muted
                                                />
                                                <div
                                                    style={{
                                                        position: 'absolute',
                                                        inset: 0,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        backgroundColor: 'rgba(0,0,0,0.3)',
                                                    }}
                                                >
                                                    <span style={{ fontSize: 16 }}>🎬</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <Image source={{ uri: url }} style={styles.galleryThumbImg} />
                                        )}
                                        <Text style={styles.galleryThumbNumber}>{`${gIdx + 1}`}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </MouseDragHorizontalScroll>
                    </ScrollView>

                    <View style={styles.modalFooter}>
                        <TouchableOpacity style={styles.modalCancelBtn} onPress={onClose}>
                            <Text style={styles.modalCancelBtnText}>닫기</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.65)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContainer: {
        width: '100%',
        maxWidth: 980,
        maxHeight: '92%',
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        overflow: 'hidden',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#E4E4E7',
        backgroundColor: '#FAF5EE',
    },
    modalHeaderTitle: { fontSize: 18, fontWeight: '800', color: '#2C231B' },
    modalHeaderSub: { fontSize: 12, color: '#786A5E', marginTop: 2 },
    modalCloseBtn: { padding: 6 },
    modalCloseBtnText: { fontSize: 18, color: '#71717A', fontWeight: '700' },
    modalBody: { flex: 1 },
    galleryMainBox: {
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        backgroundColor: '#18181B',
        borderRadius: 12,
        overflow: 'hidden',
        padding: 10,
        minHeight: 380,
    },
    galleryMainLargeImg: { width: '100%', height: 380 },
    navArrowBtn: {
        position: 'absolute',
        top: '50%',
        marginTop: -22,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(0,0,0,0.55)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 20,
    },
    navArrowBtnLeft: { left: 14 },
    navArrowBtnRight: { right: 14 },
    navArrowText: { color: '#FFFFFF', fontSize: 28, fontWeight: '300', lineHeight: 30 },
    galleryIndexIndicator: {
        position: 'absolute',
        bottom: 12,
        right: 14,
        backgroundColor: 'rgba(0,0,0,0.7)',
        color: '#FFFFFF',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        fontSize: 12,
        fontWeight: '700',
    },
    formLabel: { fontSize: 13, fontWeight: '700', color: '#3F3F46', marginBottom: -6 },
    galleryAllThumbsRow: { flexDirection: 'row', gap: 8, paddingVertical: 6 },
    galleryThumbItem: {
        position: 'relative',
        width: 80,
        height: 60,
        borderRadius: 8,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: '#E4E4E7',
    },
    galleryThumbItemActive: { borderColor: '#F5933C' },
    galleryThumbImg: { width: '100%', height: '100%' },
    galleryThumbNumber: {
        position: 'absolute',
        bottom: 2,
        left: 2,
        backgroundColor: 'rgba(0,0,0,0.65)',
        color: '#FFFFFF',
        fontSize: 10,
        paddingHorizontal: 4,
        borderRadius: 3,
        fontWeight: '700',
    },
    modalFooter: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: 24,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderTopColor: '#E4E4E7',
        backgroundColor: '#FFFFFF',
    },
    modalCancelBtn: {
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        backgroundColor: '#F4F4F5',
    },
    modalCancelBtnText: { color: '#52525B', fontSize: 13, fontWeight: '700' },
});
