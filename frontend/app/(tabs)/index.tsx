// frontend/app/(tabs)/index.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
    StyleSheet,
    Text,
    View,
    TouchableOpacity,
    ScrollView,
    Platform,
    Image,
    ActivityIndicator,
    TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { analyzeMultiImageMemoryWithGemini, refineMemoryWithGemini } from '../../services/geminiService';
import { useMemory, MemoryItem } from '../../context/MemoryContext';
import { MouseDragHorizontalScroll } from '../../features/backup/MouseDragHorizontalScroll';
import { DroppableAlbumCard } from '../../features/index/DroppableAlbumCard';
import { GalleryViewerModal } from '../../features/index/GalleryViewerModal';
import { EditMemoryModal } from '../../features/index/EditMemoryModal';
import {
    isVideoUrl,
    extractFramesFromVideo,
    compressImageForAnalysis,
    readFileAsDataURL,
} from '../../utils/mediaProcessUtils';

const MAX_IMAGE_COUNT = 50;

export default function HomeScreen() {
    const router = useRouter();
    const {
        memoryList,
        addMultiImageMemoryToServer,
        appendFilesToMemory,
        updateMemoryItem,
        setSelectedEnhanceMemory,
        addToGeneratedNotes,
        addMultipleToGeneratedNotes,
        deleteMemoryItem,
        deleteMultipleMemoryItems,
        clearAllMemories,
    } = useMemory();

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadingText, setLoadingText] = useState<string>('');
    const [progressPercent, setProgressPercent] = useState<number>(0);

    const [isDragging, setIsDragging] = useState<boolean>(false);
    const dropAreaRef = useRef<any>(null);

    const [userNotes, setUserNotes] = useState<{ [key: string]: string }>({});
    const [refiningMap, setRefiningMap] = useState<{ [key: string]: boolean }>({});
    const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());

    // 갤러리 및 편집 모달 상태
    const [galleryItem, setGalleryItem] = useState<MemoryItem | null>(null);
    const [galleryInitialIdx, setGalleryInitialIdx] = useState<number>(0);
    const [editingItem, setEditingItem] = useState<MemoryItem | null>(null);

    const toggleSelectCard = (id: string) => {
        setSelectedCardIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleToggleSelectAll = () => {
        const isAll = memoryList.length > 0 && memoryList.every((item) => selectedCardIds.has(item.id));
        setSelectedCardIds(isAll ? new Set() : new Set(memoryList.map((item) => item.id)));
    };

    const handleSendSelectedToGenerate = () => {
        if (selectedCardIds.size === 0) return;
        const selectedItems = memoryList.filter((item) => selectedCardIds.has(item.id));
        addMultipleToGeneratedNotes(selectedItems);
        setSelectedCardIds(new Set());
        router.push('/generate');
    };

    const handleBatchDeleteFromIndex = async () => {
        if (selectedCardIds.size === 0) return;
        const count = selectedCardIds.size;
        const ok =
            Platform.OS === 'web'
                ? window.confirm(
                      `선택한 ${count}개의 앨범을 현재 작업 목록에서만 제외하시겠습니까?\n(※ 보관함에는 안전하게 보존됩니다.)`,
                  )
                : true;
        if (!ok) return;

        await deleteMultipleMemoryItems(Array.from(selectedCardIds));
        setSelectedCardIds(new Set());
    };

    const executeAppendFilesToMemory = async (targetItem: MemoryItem, newFiles: File[]) => {
        const validFiles = newFiles.filter(
            (f) =>
                f.type.startsWith('image/') ||
                f.type.startsWith('video/') ||
                f.name.toLowerCase().endsWith('.heic') ||
                f.name.toLowerCase().endsWith('.mp4') ||
                f.name.toLowerCase().endsWith('.mov') ||
                f.name.toLowerCase().endsWith('.webm') ||
                f.name.toLowerCase().endsWith('.m4v'),
        );

        if (validFiles.length === 0) {
            alert('추가 가능한 사진 또는 동영상 파일이 없습니다.');
            return;
        }

        const currentCount = targetItem.imageUrls.length;
        if (currentCount + validFiles.length > MAX_IMAGE_COUNT) {
            alert(`⚠️ 한 앨범당 최대 ${MAX_IMAGE_COUNT}장까지만 보관할 수 있습니다. (현재: ${currentCount}장)`);
            return;
        }

        setIsLoading(true);
        setLoadingText(`'${targetItem.analysis?.title || '추억'}'에 새로운 미디어(${validFiles.length}개) 추가 중...`);
        setProgressPercent(30);

        try {
            const res = await appendFilesToMemory(targetItem.id, validFiles);
            setProgressPercent(80);

            if (res) {
                const shouldReAnalyze = window.confirm(
                    `✨ ${validFiles.length}개의 미디어가 성공적으로 추가되었습니다!\n\n새로 추가된 사진들을 바탕으로 Gemini AI에게 기존 사연을 보강하여 다시 작성하게 하시겠습니까?`,
                );

                if (shouldReAnalyze && targetItem.analysis) {
                    setLoadingText('새로 추가된 사진을 포함하여 Gemini AI가 사연을 다시 보강 중...');
                    setProgressPercent(90);

                    const refineNote = `새로 추가된 ${validFiles.length}장의 사진 내용도 함께 종합하여 전체 상황 요약과 감성 에세이를 더 풍성하게 다듬어줘.`;
                    const currentDraft = {
                        title: targetItem.analysis.title || '',
                        location: targetItem.analysis.location || '',
                        yearEstimate: targetItem.analysis.yearEstimate || '',
                        description: targetItem.analysis.description || '',
                        storyCaption: targetItem.analysis.storyCaption || '',
                        audioTranscriptSummary: targetItem.analysis.audioTranscriptSummary || '',
                    };
                    const refined = await refineMemoryWithGemini(currentDraft, refineNote);
                    await updateMemoryItem(targetItem.id, refined);
                }
            }
            setProgressPercent(100);
        } catch (err: any) {
            alert(`추가 오류: ${err.message || '다시 시도해주세요.'}`);
        } finally {
            setIsLoading(false);
            setLoadingText('');
            setProgressPercent(0);
        }
    };

    const handleAppendMediaToMemory = (targetItem: MemoryItem) => {
        if (Platform.OS === 'web') {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = 'image/*,video/*,.mp4,.mov,.webm,.m4v,.heic,.HEIC';
            input.style.display = 'none';

            input.onchange = async (e: any) => {
                const fileList: FileList = e.target.files;
                if (fileList && fileList.length > 0) {
                    await executeAppendFilesToMemory(targetItem, Array.from(fileList));
                }
                input.remove();
            };

            document.body.appendChild(input);
            input.click();
        }
    };

    const processUploadedFiles = async (files: File[]) => {
        if (!files || files.length === 0) return;

        let imageFiles = files.filter(
            (f) =>
                f.type.startsWith('image/') ||
                f.name.toLowerCase().endsWith('.heic') ||
                f.name.toLowerCase().endsWith('.heif'),
        );
        const videoFiles = files.filter(
            (f) =>
                f.type.startsWith('video/') ||
                f.name.toLowerCase().endsWith('.mp4') ||
                f.name.toLowerCase().endsWith('.mov') ||
                f.name.toLowerCase().endsWith('.m4v') ||
                f.name.toLowerCase().endsWith('.webm'),
        );
        const audioFiles = files.filter(
            (f) =>
                f.type.startsWith('audio/') ||
                f.name.toLowerCase().endsWith('.m4a') ||
                f.name.toLowerCase().endsWith('.mp3'),
        );

        if (imageFiles.length === 0 && videoFiles.length === 0) {
            alert('최소 1개 이상의 사진 또는 동영상 파일을 선택해주세요.');
            return;
        }

        setIsLoading(true);
        setProgressPercent(5);

        try {
            let aiTargetImages = [...imageFiles];
            if (videoFiles.length > 0) {
                setLoadingText(`동영상(${videoFiles.length}개)에서 핵심 장면 추출 중...`);
                for (let i = 0; i < videoFiles.length; i++) {
                    const frames = await extractFramesFromVideo(videoFiles[i], 3);
                    aiTargetImages = [...aiTargetImages, ...frames];
                }
            }

            const allUploadFiles = [...imageFiles, ...videoFiles];

            if (allUploadFiles.length > MAX_IMAGE_COUNT) {
                alert(
                    `⚠️ 사진 및 동영상 파일은 한 번에 최대 ${MAX_IMAGE_COUNT}개까지만 처리할 수 있습니다.\n(현재 총합: ${allUploadFiles.length}개)`,
                );
                setIsLoading(false);
                return;
            }

            const totalCount = allUploadFiles.length;
            setProgressPercent(15);
            setLoadingText(`총 ${totalCount}개의 미디어 데이터 최적화 준비 중...`);

            let targetSampledFiles = aiTargetImages;
            const MAX_AI_INPUT_IMAGES = 28;

            if (aiTargetImages.length > MAX_AI_INPUT_IMAGES) {
                const step = aiTargetImages.length / MAX_AI_INPUT_IMAGES;
                targetSampledFiles = [];
                for (let i = 0; i < MAX_AI_INPUT_IMAGES; i++) {
                    targetSampledFiles.push(aiTargetImages[Math.floor(i * step)]);
                }
            }

            const loadedImages = [];
            const sampleCount = targetSampledFiles.length;

            for (let i = 0; i < sampleCount; i++) {
                const compressed = await compressImageForAnalysis(targetSampledFiles[i]);
                loadedImages.push(compressed);

                const currentPct = Math.round(15 + ((i + 1) / sampleCount) * 40);
                setProgressPercent(currentPct);
                setLoadingText(`이미지 데이터 인코딩 중 (${i + 1} / ${sampleCount})`);
            }

            let audioData: { base64: string; mimeType: string; file: File } | undefined;
            if (audioFiles.length > 0) {
                setProgressPercent(60);
                setLoadingText('음성 사연 데이터 추출 중...');
                const firstAudio = audioFiles[0];
                const audioDataUrl = await readFileAsDataURL(firstAudio);
                audioData = {
                    base64: audioDataUrl.split(',')[1],
                    mimeType: firstAudio.type || 'audio/mp3',
                    file: firstAudio,
                };
            }

            setProgressPercent(65);
            setLoadingText(`Gemini AI가 사진과 동영상 속 추억 흐름을 종합 분석 중...`);

            const analysisResultPromise = analyzeMultiImageMemoryWithGemini(
                loadedImages,
                audioData?.base64,
                audioData?.mimeType,
            );

            const intervalTimer = setInterval(() => {
                setProgressPercent((prev) => (prev < 88 ? prev + 4 : prev));
            }, 700);

            const analysisResult = await analysisResultPromise;
            clearInterval(intervalTimer);

            setProgressPercent(90);
            setLoadingText(`추억 앨범(${totalCount}개 미디어 전체) 저장 및 백업 동기화 중...`);

            const id = `album_${Date.now()}`;
            await addMultiImageMemoryToServer(id, allUploadFiles, analysisResult, audioData?.file);

            setProgressPercent(100);
            setLoadingText('분석 완료!');
            await new Promise((res) => setTimeout(res, 250));
        } catch (error: any) {
            console.error(error);
            alert(`분석 오류: ${error.message || '다시 시도해주세요.'}`);
        } finally {
            setIsLoading(false);
            setLoadingText('');
            setProgressPercent(0);
            setIsDragging(false);
        }
    };

    const handleSelectFiles = () => {
        if (Platform.OS === 'web') {
            const existingInput = document.getElementById('memory-file-input');
            if (existingInput) existingInput.remove();

            const input = document.createElement('input');
            input.id = 'memory-file-input';
            input.type = 'file';
            input.multiple = true;
            input.accept = 'image/*,video/*,audio/*,.mp3,.m4a,.wav,.aac,.ogg,.heic,.HEIC,.mp4,.mov,.webm,.m4v';
            input.style.display = 'none';

            input.onchange = async (e: any) => {
                const fileList: FileList = e.target.files;
                if (fileList && fileList.length > 0) {
                    await processUploadedFiles(Array.from(fileList));
                }
                input.remove();
            };

            document.body.appendChild(input);
            input.click();
        }
    };

    useEffect(() => {
        if (Platform.OS !== 'web') return;

        const handleGlobalDrag = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
        };

        window.addEventListener('dragover', handleGlobalDrag);
        window.addEventListener('drop', handleGlobalDrag);

        const domElement = dropAreaRef.current;
        if (!domElement) return;

        const handleDragEnter = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(true);
        };

        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isDragging) setIsDragging(true);
        };

        const handleDragLeave = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.currentTarget === e.target || (e.relatedTarget && !domElement.contains(e.relatedTarget as Node))) {
                setIsDragging(false);
            }
        };

        const handleDrop = async (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);

            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const droppedFiles = Array.from(e.dataTransfer.files);
                await processUploadedFiles(droppedFiles);
            }
        };

        domElement.addEventListener('dragenter', handleDragEnter);
        domElement.addEventListener('dragover', handleDragOver);
        domElement.addEventListener('dragleave', handleDragLeave);
        domElement.addEventListener('drop', handleDrop);

        return () => {
            window.removeEventListener('dragover', handleGlobalDrag);
            window.removeEventListener('drop', handleGlobalDrag);
            domElement.removeEventListener('dragenter', handleDragEnter);
            domElement.removeEventListener('dragover', handleDragOver);
            domElement.removeEventListener('dragleave', handleDragLeave);
            domElement.removeEventListener('drop', handleDrop);
        };
    }, []);

    const handleRefineMemory = async (item: MemoryItem) => {
        const note = userNotes[item.id]?.trim();
        if (!note) {
            alert('추가할 실제 기억이나 수정하고 싶은 내용을 입력해주세요.');
            return;
        }

        if (!item.analysis) return;

        setRefiningMap((prev) => ({ ...prev, [item.id]: true }));
        try {
            const currentDraft = {
                title: item.analysis.title || '',
                location: item.analysis.location || '',
                yearEstimate: item.analysis.yearEstimate || '',
                description: item.analysis.description || '',
                storyCaption: item.analysis.storyCaption || '',
                audioTranscriptSummary: item.analysis.audioTranscriptSummary || '',
            };
            const refinedResult = await refineMemoryWithGemini(currentDraft, note);
            await updateMemoryItem(item.id, refinedResult);
            setUserNotes((prev) => ({ ...prev, [item.id]: '' }));
        } catch (e: any) {
            alert(`노트 재분석 오류: ${e.message || '오류가 발생했습니다.'}`);
        } finally {
            setRefiningMap((prev) => ({ ...prev, [item.id]: false }));
        }
    };

    const handleClearActiveMemories = async () => {
        const confirmed =
            Platform.OS === 'web'
                ? window.confirm('현재 작업 화면의 목록을 비우시겠습니까?\n(※ 보관함 파일은 안전하게 보존됩니다.)')
                : true;

        if (confirmed) {
            await clearAllMemories();
            setSelectedCardIds(new Set());
        }
    };

    const isAllSelected = memoryList.length > 0 && memoryList.every((item) => selectedCardIds.has(item.id));

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
            <View style={styles.header}>
                <Text style={styles.logoText}>Memory-Tracer</Text>
            </View>

            <View style={styles.heroSection}>
                <View ref={dropAreaRef} style={styles.dropZoneContainer}>
                    <View style={[styles.dropZoneBorder, isDragging && styles.dropZoneBorderActive]}>
                        <Text style={styles.dropZoneTitle}>
                            {isDragging
                                ? '📂 사진, 동영상, 음성을 여기에 놓으세요!'
                                : '여러 장의 사진/동영상과 음성으로 하나의 추억 앨범을 만들어보세요'}
                        </Text>
                        <Text style={styles.dropZoneSubtitle}>
                            {isDragging
                                ? '마우스를 놓으면 자동으로 통합 멀티모달 분석이 시작됩니다.'
                                : '파일을 직접 끌어다 놓거나 선택해주세요. (완성된 개별 카드 위로도 직접 드래그 드롭 가능)'}
                        </Text>

                        <View style={styles.fileIconWrapper}>
                            <Text style={styles.fileIcon}>{isDragging ? '📥' : '📸 🎬 🎙️'}</Text>
                        </View>

                        <TouchableOpacity
                            style={[styles.selectButton, isLoading && { opacity: 0.7 }]}
                            onPress={handleSelectFiles}
                            disabled={isLoading}
                        >
                            <Text style={styles.selectButtonText}>
                                {isLoading ? 'Analyzing the Data' : 'Insert the Data'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {/* 프로그레스 바 UI */}
            {isLoading && (
                <View style={styles.progressContainer}>
                    <View style={styles.progressCard}>
                        <View style={styles.progressHeaderRow}>
                            <Text style={styles.progressStatusText}>{loadingText}</Text>
                            <Text style={styles.progressPercentText}>{`${progressPercent}%`}</Text>
                        </View>
                        <View style={styles.progressBarTrack}>
                            <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
                        </View>
                        <View style={styles.progressFooterRow}>
                            <ActivityIndicator size="small" color="#F5933C" />
                            <Text style={styles.progressSubHint}>사진 및 영상 속 단서를 정밀 추론하고 있습니다...</Text>
                        </View>
                    </View>
                </View>
            )}

            {memoryList.length > 0 && !isLoading && (
                <View style={styles.resultSection}>
                    <View style={styles.resultHeaderRow}>
                        <View>
                            <Text
                                style={styles.resultSectionTitle}
                            >{`✨ 완성된 추억 앨범 (${memoryList.length}개)`}</Text>
                            <Text style={styles.resultSectionSubtitle}>
                                각 카드 위로 사진을 드래그 앤 드롭하여 바로 추가하거나, 체크박스로 노트를 내보낼 수
                                있습니다.
                            </Text>
                        </View>

                        <View style={styles.headerBtnGroup}>
                            <TouchableOpacity style={styles.selectAllBtn} onPress={handleToggleSelectAll}>
                                <Text style={styles.selectAllBtnText}>
                                    {isAllSelected ? '선택 해제 ✕' : '전체 선택 ✓'}
                                </Text>
                            </TouchableOpacity>

                            {selectedCardIds.size > 0 && (
                                <>
                                    <TouchableOpacity
                                        style={styles.batchGenerateBtn}
                                        onPress={handleSendSelectedToGenerate}
                                    >
                                        <Text style={styles.batchGenerateBtnText}>
                                            {`📖 선택 노트 내보내기 (${selectedCardIds.size}개) →`}
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={styles.batchDeleteFromIndexBtn}
                                        onPress={handleBatchDeleteFromIndex}
                                    >
                                        <Text style={styles.batchDeleteFromIndexBtnText}>
                                            {`🗑️ 선택 제외 (${selectedCardIds.size}개)`}
                                        </Text>
                                    </TouchableOpacity>
                                </>
                            )}

                            <TouchableOpacity style={styles.clearListBtn} onPress={handleClearActiveMemories}>
                                <Text style={styles.clearListBtnText}>🧹 목록 비우기</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.resultList}>
                        {memoryList.map((item, idx) => {
                            const isRefining = refiningMap[item.id] || false;
                            const isSelected = selectedCardIds.has(item.id);

                            return (
                                <DroppableAlbumCard
                                    key={item.id}
                                    item={item}
                                    isSelected={isSelected}
                                    onDropFiles={(droppedItem, droppedFiles) =>
                                        executeAppendFilesToMemory(droppedItem, droppedFiles)
                                    }
                                >
                                    <TouchableOpacity
                                        style={[styles.cardCheckbox, isSelected && styles.cardCheckboxActive]}
                                        onPress={() => toggleSelectCard(item.id)}
                                    >
                                        <Text style={[styles.cardCheckmark, isSelected && styles.cardCheckmarkActive]}>
                                            {isSelected ? '✓' : ''}
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={styles.deleteCardBtn}
                                        onPress={() => deleteMemoryItem(item.id)}
                                        accessibilityLabel="목록에서 제외"
                                    >
                                        <Text style={styles.deleteCardBtnText}>✕</Text>
                                    </TouchableOpacity>

                                    <View style={styles.imageColumn}>
                                        <MouseDragHorizontalScroll
                                            contentContainerStyle={styles.multiImageScroll}
                                            style={{ paddingVertical: 4 }}
                                        >
                                            {item.imageUrls.slice(0, 12).map((mediaUrl, imgIdx) => {
                                                const isVid = isVideoUrl(mediaUrl);
                                                return (
                                                    <TouchableOpacity
                                                        key={imgIdx}
                                                        activeOpacity={0.85}
                                                        onPress={() => {
                                                            setGalleryItem(item);
                                                            setGalleryInitialIdx(imgIdx);
                                                        }}
                                                        style={{ position: 'relative' }}
                                                    >
                                                        {isVid && Platform.OS === 'web' ? (
                                                            <div
                                                                style={{
                                                                    position: 'relative',
                                                                    width: 180,
                                                                    height: 130,
                                                                }}
                                                            >
                                                                <video
                                                                    src={mediaUrl}
                                                                    style={{
                                                                        width: 180,
                                                                        height: 130,
                                                                        borderRadius: 8,
                                                                        objectFit: 'cover',
                                                                        backgroundColor: '#000',
                                                                    }}
                                                                    muted
                                                                />
                                                                <div
                                                                    style={{
                                                                        position: 'absolute',
                                                                        inset: 0,
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        backgroundColor: 'rgba(0,0,0,0.35)',
                                                                        borderRadius: 8,
                                                                    }}
                                                                >
                                                                    <span style={{ fontSize: 28 }}>▶</span>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <Image
                                                                source={{ uri: mediaUrl }}
                                                                style={styles.previewImage}
                                                                resizeMode="cover"
                                                            />
                                                        )}
                                                    </TouchableOpacity>
                                                );
                                            })}

                                            {item.imageUrls.length > 12 && (
                                                <TouchableOpacity
                                                    style={styles.morePhotoBadge}
                                                    activeOpacity={0.8}
                                                    onPress={() => {
                                                        setGalleryItem(item);
                                                        setGalleryInitialIdx(12);
                                                    }}
                                                >
                                                    <Text style={styles.morePhotoBadgeIcon}>🔍</Text>
                                                    <Text
                                                        style={styles.morePhotoBadgeText}
                                                    >{`+${item.imageUrls.length - 12}개 더보기`}</Text>
                                                    <Text
                                                        style={styles.morePhotoSubText}
                                                    >{`(전체 ${item.imageUrls.length}개)`}</Text>
                                                </TouchableOpacity>
                                            )}
                                        </MouseDragHorizontalScroll>

                                        <View style={styles.photoCountRow}>
                                            <Text style={styles.fileNameText}>
                                                {`🖼️ 총 ${item.imageUrls.length}개의 미디어 포함 (여기로 파일 드래그 드롭 가능)`}
                                            </Text>
                                            <TouchableOpacity
                                                onPress={() => {
                                                    setGalleryItem(item);
                                                    setGalleryInitialIdx(0);
                                                }}
                                            >
                                                <Text style={styles.viewAllPhotosLinkText}>전체 갤러리 열기 ↗</Text>
                                            </TouchableOpacity>
                                        </View>

                                        {item.audioFileName && (
                                            <Text
                                                style={styles.audioFileNameText}
                                                numberOfLines={1}
                                                ellipsizeMode="middle"
                                            >
                                                {`🎙️ ${item.audioFileName}`}
                                            </Text>
                                        )}
                                    </View>

                                    <View style={styles.resultInfo}>
                                        <View style={styles.cardHeaderRow}>
                                            <Text
                                                style={styles.noteTitle}
                                            >{`${idx + 1}. ${item.analysis?.title || '종합 분석 완료'}`}</Text>
                                            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                                                <TouchableOpacity
                                                    style={styles.addMediaBtn}
                                                    onPress={() => handleAppendMediaToMemory(item)}
                                                >
                                                    <Text style={styles.addMediaBtnText}>➕ 미디어 추가</Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={styles.editOpenBtn}
                                                    onPress={() => setEditingItem(item)}
                                                >
                                                    <Text style={styles.editOpenBtnText}>✏️ 상세 편집</Text>
                                                </TouchableOpacity>
                                            </View>
                                        </View>

                                        {item.analysis && (
                                            <>
                                                <View style={styles.tagRow}>
                                                    <Text style={styles.tag}>{`📍 ${item.analysis.location}`}</Text>
                                                    <Text style={styles.tag}>{`⏳ ${item.analysis.yearEstimate}`}</Text>
                                                </View>

                                                {item.analysis.audioTranscriptSummary ? (
                                                    <View style={styles.audioSummaryBox}>
                                                        <Text style={styles.audioSummaryLabel}>🎙️ 음성 요약:</Text>
                                                        <Text style={styles.audioSummaryText}>
                                                            {item.analysis.audioTranscriptSummary}
                                                        </Text>
                                                    </View>
                                                ) : null}

                                                <Text style={styles.label}>종합 상황 요약:</Text>
                                                <Text style={styles.descText}>{item.analysis.description}</Text>

                                                {item.analysis.storyCaption ? (
                                                    <View style={styles.storyBox}>
                                                        <Text style={styles.storyLabel}>📖 통합 추억 에세이:</Text>
                                                        <Text style={styles.storyText}>
                                                            {item.analysis.storyCaption}
                                                        </Text>
                                                    </View>
                                                ) : null}

                                                <View style={styles.refineSection}>
                                                    <Text style={styles.refineLabel}>
                                                        💡 AI에게 실제 기억 추가 전달하기 (예: "사실 2018년 여름 가족
                                                        여행 때임")
                                                    </Text>
                                                    <View style={styles.refineInputRow}>
                                                        <TextInput
                                                            style={styles.refineInput}
                                                            placeholder="추가할 기억이나 보완할 내용을 적어주세요..."
                                                            placeholderTextColor="#A1A1AA"
                                                            value={userNotes[item.id] || ''}
                                                            onChangeText={(text) =>
                                                                setUserNotes((prev) => ({ ...prev, [item.id]: text }))
                                                            }
                                                            editable={!isRefining}
                                                        />
                                                        <TouchableOpacity
                                                            style={[styles.refineBtn, isRefining && { opacity: 0.6 }]}
                                                            onPress={() => handleRefineMemory(item)}
                                                            disabled={isRefining}
                                                        >
                                                            {isRefining ? (
                                                                <ActivityIndicator size="small" color="#FFFFFF" />
                                                            ) : (
                                                                <Text style={styles.refineBtnText}>⚡ AI 재분석</Text>
                                                            )}
                                                        </TouchableOpacity>
                                                    </View>
                                                </View>

                                                <View style={styles.sectionDivider} />

                                                <View style={styles.actionButtonGroup}>
                                                    <TouchableOpacity
                                                        style={styles.enhanceActionBtn}
                                                        onPress={() => {
                                                            setSelectedEnhanceMemory(item);
                                                            router.push('/enhance');
                                                        }}
                                                    >
                                                        <Text style={styles.enhanceActionBtnText}>
                                                            ✨ 사진 화질 개선
                                                        </Text>
                                                    </TouchableOpacity>

                                                    <TouchableOpacity
                                                        style={styles.generateActionBtn}
                                                        onPress={() => {
                                                            addToGeneratedNotes(item);
                                                            router.push('/generate');
                                                        }}
                                                    >
                                                        <Text style={styles.generateActionBtnText}>
                                                            ✍️ 완성된 추억 노트 보기
                                                        </Text>
                                                    </TouchableOpacity>
                                                </View>
                                            </>
                                        )}
                                    </View>
                                </DroppableAlbumCard>
                            );
                        })}
                    </View>
                </View>
            )}

            {/* 분리된 전용 모달 */}
            <GalleryViewerModal
                item={galleryItem}
                initialIdx={galleryInitialIdx}
                onClose={() => setGalleryItem(null)}
            />
            <EditMemoryModal item={editingItem} onClose={() => setEditingItem(null)} />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FFFFFF' },
    contentContainer: { flexGrow: 1, paddingBottom: 60 },
    header: {
        height: 64,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        paddingHorizontal: 32,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    logoText: { fontSize: 22, fontWeight: '700', color: '#1A1A1A' },
    heroSection: {
        backgroundColor: '#FDECC8',
        paddingVertical: 48,
        paddingHorizontal: 32,
        alignItems: 'center',
    },
    dropZoneContainer: { width: '100%', maxWidth: 960 },
    dropZoneBorder: {
        borderWidth: 2,
        borderColor: '#D4C4A8',
        borderStyle: 'dashed',
        borderRadius: 12,
        paddingVertical: 48,
        paddingHorizontal: 24,
        alignItems: 'center',
        backgroundColor: 'transparent',
    },
    dropZoneBorderActive: {
        borderColor: '#F5933C',
        backgroundColor: '#FCE7BD',
    },
    dropZoneTitle: { fontSize: 22, fontWeight: '600', color: '#2D2D2D', marginBottom: 6, textAlign: 'center' },
    dropZoneSubtitle: { fontSize: 14, color: '#6B5E4C', marginBottom: 20, textAlign: 'center' },
    fileIconWrapper: { marginBottom: 20 },
    fileIcon: { fontSize: 36 },
    selectButton: {
        backgroundColor: '#F5933C',
        paddingVertical: 12,
        paddingHorizontal: 28,
        borderRadius: 8,
    },
    selectButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
    progressContainer: {
        alignItems: 'center',
        paddingHorizontal: 24,
        marginVertical: 28,
    },
    progressCard: {
        width: '100%',
        maxWidth: 600,
        backgroundColor: '#FFFDF9',
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: '#FBD38D',
        padding: 20,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
    },
    progressHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    progressStatusText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#2D3748',
        flex: 1,
        paddingRight: 10,
    },
    progressPercentText: {
        fontSize: 16,
        fontWeight: '800',
        color: '#DD6B20',
    },
    progressBarTrack: {
        width: '100%',
        height: 10,
        backgroundColor: '#EDF2F7',
        borderRadius: 5,
        overflow: 'hidden',
        marginBottom: 12,
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: '#F5933C',
        borderRadius: 5,
    },
    progressFooterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    progressSubHint: {
        fontSize: 12,
        color: '#718096',
    },
    resultSection: { paddingHorizontal: 32, paddingTop: 32, alignItems: 'center' },
    resultHeaderRow: {
        maxWidth: 960,
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 12,
    },
    resultSectionTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A1A' },
    resultSectionSubtitle: { fontSize: 13, color: '#71717A', marginTop: 2 },
    headerBtnGroup: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
    selectAllBtn: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: '#F4F4F5',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        borderRadius: 8,
    },
    selectAllBtnText: { fontSize: 13, color: '#3F3F46', fontWeight: '700' },
    batchGenerateBtn: {
        paddingVertical: 8,
        paddingHorizontal: 14,
        backgroundColor: '#F5933C',
        borderRadius: 8,
    },
    batchGenerateBtnText: { fontSize: 13, color: '#FFFFFF', fontWeight: '700' },
    batchDeleteFromIndexBtn: {
        paddingVertical: 8,
        paddingHorizontal: 14,
        backgroundColor: '#FEE2E2',
        borderWidth: 1,
        borderColor: '#FCA5A5',
        borderRadius: 8,
    },
    batchDeleteFromIndexBtnText: { fontSize: 13, color: '#DC2626', fontWeight: '700' },
    clearListBtn: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: '#F4F4F5',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        borderRadius: 8,
    },
    clearListBtnText: { fontSize: 13, color: '#52525B', fontWeight: '700' },
    resultList: { width: '100%', maxWidth: 960, gap: 20 },
    cardCheckbox: {
        position: 'absolute',
        top: 14,
        left: 14,
        width: 24,
        height: 24,
        borderRadius: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderWidth: 1.5,
        borderColor: '#A1A1AA',
        zIndex: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardCheckboxActive: {
        backgroundColor: '#F5933C',
        borderColor: '#F5933C',
    },
    cardCheckmark: { fontSize: 12, color: 'transparent', fontWeight: '800' },
    cardCheckmarkActive: { color: '#FFFFFF' },
    imageColumn: { width: '100%', gap: 8, paddingLeft: 30 },
    multiImageScroll: { flexDirection: 'row', gap: 10 },
    previewImage: { width: 180, height: 130, borderRadius: 8, backgroundColor: '#F4F4F5' },
    morePhotoBadge: {
        width: 120,
        height: 130,
        borderRadius: 8,
        backgroundColor: '#26201B',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 8,
        gap: 4,
    },
    morePhotoBadgeIcon: { fontSize: 18 },
    morePhotoBadgeText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '700',
        textAlign: 'center',
    },
    morePhotoSubText: {
        color: '#FBD38D',
        fontSize: 10,
        fontWeight: '600',
    },
    photoCountRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingRight: 10,
        marginTop: 4,
    },
    viewAllPhotosLinkText: {
        fontSize: 12,
        color: '#F5933C',
        fontWeight: '700',
        textDecorationLine: 'underline',
    },
    fileNameText: { fontSize: 12, color: '#71717A', fontWeight: '600' },
    audioFileNameText: { fontSize: 12, color: '#2563EB', fontWeight: '600' },
    deleteCardBtn: {
        position: 'absolute',
        top: 14,
        right: 14,
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#F4F4F5',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
    },
    deleteCardBtnText: { fontSize: 14, color: '#71717A', fontWeight: '700', lineHeight: 16 },
    resultInfo: { width: '100%' },
    cardHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
        paddingRight: 32,
        flexWrap: 'wrap',
        gap: 8,
    },
    noteTitle: { fontSize: 20, fontWeight: '700', color: '#18181B', flex: 1 },
    addMediaBtn: {
        backgroundColor: '#F0FDF4',
        borderWidth: 1,
        borderColor: '#86EFAC',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
    },
    addMediaBtnText: { fontSize: 12, fontWeight: '700', color: '#15803D' },
    editOpenBtn: {
        backgroundColor: '#F4F4F5',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
    },
    editOpenBtnText: { fontSize: 12, fontWeight: '700', color: '#18181B' },
    tagRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    tag: {
        backgroundColor: '#F4F4F5',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        fontSize: 13,
        color: '#52525B',
    },
    audioSummaryBox: {
        backgroundColor: '#EFF6FF',
        padding: 10,
        borderRadius: 8,
        marginBottom: 8,
        borderLeftWidth: 3,
        borderLeftColor: '#3B82F6',
    },
    audioSummaryLabel: { fontSize: 12, fontWeight: '700', color: '#1D4ED8', marginBottom: 2 },
    audioSummaryText: { fontSize: 13, color: '#1E40AF', lineHeight: 18 },
    label: { fontSize: 12, fontWeight: '600', color: '#71717A', marginBottom: 4 },
    descText: { fontSize: 14, color: '#3F3F46', lineHeight: 20, marginBottom: 10 },
    storyBox: {
        backgroundColor: '#FAF5FF',
        padding: 14,
        borderRadius: 8,
        borderLeftWidth: 3,
        borderLeftColor: '#A855F7',
        marginBottom: 12,
    },
    storyLabel: { fontSize: 13, fontWeight: '700', color: '#7E22CE', marginBottom: 4 },
    storyText: { fontSize: 14, color: '#6B21A8', lineHeight: 22 },
    refineSection: {
        backgroundColor: '#F8FAFC',
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        marginTop: 6,
        marginBottom: 8,
    },
    refineLabel: { fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 6 },
    refineInputRow: { flexDirection: 'row', gap: 8 },
    refineInput: {
        flex: 1,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        fontSize: 13,
        color: '#1E293B',
    },
    refineBtn: {
        backgroundColor: '#0F172A',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 6,
        justifyContent: 'center',
        alignItems: 'center',
    },
    refineBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
    sectionDivider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 12 },
    actionButtonGroup: { flexDirection: 'row', gap: 12, marginTop: 4 },
    enhanceActionBtn: {
        flex: 1,
        backgroundColor: '#EEF2FF',
        borderWidth: 1.5,
        borderColor: '#6366F1',
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    enhanceActionBtnText: { color: '#4F46E5', fontSize: 14, fontWeight: '700' },
    generateActionBtn: {
        flex: 1,
        backgroundColor: '#F5933C',
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    generateActionBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
