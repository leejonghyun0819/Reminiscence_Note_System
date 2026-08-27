// frontend/features/DroppableAlbumCard.tsx
import React, { useState, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { MemoryItem } from '../../context/MemoryContext';

export const DroppableAlbumCard: React.FC<{
    item: MemoryItem;
    isSelected: boolean;
    onDropFiles: (item: MemoryItem, files: File[]) => void;
    children: React.ReactNode;
}> = ({ item, isSelected, onDropFiles, children }) => {
    const [isHoveredOver, setIsHoveredOver] = useState<boolean>(false);
    const dragCounter = useRef<number>(0);

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current += 1;
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            setIsHoveredOver(true);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isHoveredOver) setIsHoveredOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setIsHoveredOver(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current = 0;
        setIsHoveredOver(false);

        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files);
            onDropFiles(item, files);
        }
    };

    if (Platform.OS === 'web') {
        return (
            <div
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{ position: 'relative', width: '100%' }}
            >
                <View
                    style={[
                        styles.resultCard,
                        isSelected && styles.resultCardSelected,
                        isHoveredOver && styles.resultCardDragHover,
                    ]}
                >
                    {isHoveredOver && (
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                backgroundColor: 'rgba(254, 243, 199, 0.92)',
                                border: '2px dashed #F5933C',
                                borderRadius: 12,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 40,
                                pointerEvents: 'none',
                            }}
                        >
                            <span style={{ fontSize: 32, marginBottom: 8 }}>📥</span>
                            <span style={{ fontSize: 16, fontWeight: 800, color: '#9A3412' }}>
                                {`'${item.analysis?.title || '이 추억 앨범'}'에 파일 놓기`}
                            </span>
                            <span style={{ fontSize: 12, color: '#C2410C', marginTop: 4 }}>
                                마우스를 놓으면 사진/영상이 이 앨범에 즉시 추가됩니다.
                            </span>
                        </div>
                    )}
                    {children}
                </View>
            </div>
        );
    }

    return <View style={[styles.resultCard, isSelected && styles.resultCardSelected]}>{children}</View>;
};

const styles = StyleSheet.create({
    resultCard: {
        position: 'relative',
        width: '100%',
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: '#E2E2E2',
        padding: 24,
        flexDirection: 'column',
        gap: 20,
    },
    resultCardSelected: {
        borderColor: '#F5933C',
        backgroundColor: '#FFFDF9',
    },
    resultCardDragHover: {
        borderColor: '#F5933C',
        backgroundColor: '#FEF3C7',
    },
});
