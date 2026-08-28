// frontend/features/index/DroppableAlbumCard.tsx
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MemoryItem } from '../../context/MemoryContext';

interface DroppableAlbumCardProps {
    item: MemoryItem;
    isSelected?: boolean;
    onDropFiles?: (targetItem: MemoryItem, files: File[]) => void;
    children: React.ReactNode;
}

export const DroppableAlbumCard: React.FC<DroppableAlbumCardProps> = ({ item, isSelected, onDropFiles, children }) => {
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDragOver = (e: any) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: any) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    };

    const handleDrop = (e: any) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            if (onDropFiles) {
                onDropFiles(item, Array.from(e.dataTransfer.files));
            }
        }
    };

    return (
        // @ts-ignore - Web Drag & Drop
        <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} style={{ width: '100%' }}>
            <View style={[styles.card, isSelected && styles.cardSelected, isDragOver && styles.cardDragOver]}>
                {children}
            </View>
        </div>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E4E4E7',
        padding: 20,
        position: 'relative',
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        marginBottom: 20,
    },
    cardSelected: {
        borderColor: '#F5933C',
        backgroundColor: '#FFFDF9',
    },
    cardDragOver: {
        borderColor: '#6366F1',
        backgroundColor: '#EEF2FF',
        borderWidth: 2,
        borderStyle: 'dashed',
    },
});
