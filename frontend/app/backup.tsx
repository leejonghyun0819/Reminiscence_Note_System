// frontend/app/backup.tsx
import React, { useState, useEffect } from 'react';
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
import { useMemory, AnalysisVersion } from '../context/MemoryContext';
import { MouseDragHorizontalScroll } from '../features/backup/MouseDragHorizontalScroll';
import { CreateFolderModal } from '../features/backup/CreateFolderModal';
import { MoveFolderModal } from '../features/MoveFolderModal';
import { BackupDetailViewerModal, BackupAlbumMeta } from '../features/backup/BackupDetailViewerModal';
import { isVideoUrl } from '../utils/mediaProcessUtils';

const BACKEND_URL = 'http://localhost:8000';

export default function BackupPage({ onClose }: { onClose?: () => void }) {
    const router = useRouter();
    const { memoryList, appendActiveMemory, appendActiveMemories } = useMemory();

    const [backupAlbums, setBackupAlbums] = useState<BackupAlbumMeta[]>([]);
    const [folders, setFolders] = useState<string[]>([]);
    const [selectedFolderTab, setSelectedFolderTab] = useState<string>('전체');
    const [searchKeyword, setSearchKeyword] = useState<string>('');

    const [loading, setLoading] = useState<boolean>(false);
    const [fetchError, setFetchError] = useState<boolean>(false);

    const [selectedAlbumIds, setSelectedAlbumIds] = useState<Set<string>>(new Set());

    // 분리된 모달 상태들
    const [viewingAlbum, setViewingAlbum] = useState<BackupAlbumMeta | null>(null);
    const [isFolderModalOpen, setIsFolderModalOpen] = useState<boolean>(false);
    const [movingAlbum, setMovingAlbum] = useState<BackupAlbumMeta | null>(null);
    const [isBatchMovingOpen, setIsBatchMovingOpen] = useState<boolean>(false);

    const handleCloseOrBack = () => {
        if (onClose) onClose();
        else if (router.canGoBack()) router.back();
        else router.replace('/(tabs)');
    };

    const fetchBackupData = async () => {
        try {
            setLoading(true);
            setFetchError(false);
            const [albumsRes, foldersRes] = await Promise.all([
                fetch(`${BACKEND_URL}/api/backup-albums`),
                fetch(`${BACKEND_URL}/api/folders`),
            ]);

            let loadedAlbums: BackupAlbumMeta[] = [];
            if (albumsRes.ok) {
                loadedAlbums = await albumsRes.json();
                setBackupAlbums(loadedAlbums);
            } else {
                setFetchError(true);
            }

            let loadedFolders: string[] = [];
            if (foldersRes.ok) {
                loadedFolders = await foldersRes.json();
            }

            const allFolderSet = new Set<string>(loadedFolders);
            loadedAlbums.forEach((a) => {
                if (a.categoryFolder && a.categoryFolder !== '미분류') {
                    allFolderSet.add(a.categoryFolder);
                }
            });

            setFolders(Array.from(allFolderSet));
        } catch (e) {
            setFetchError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBackupData();
        setSelectedAlbumIds(new Set());
        setViewingAlbum(null);
    }, []);

    const handleCreateFolder = async (name: string) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/folders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (res.ok) {
                await fetchBackupData();
                setSelectedFolderTab(name);
            }
        } catch (e) {
            alert('폴더 생성에 실패했습니다.');
        }
    };

    const handleDeleteFolder = async (folderName: string) => {
        const ok =
            Platform.OS === 'web'
                ? window.confirm(
                      `'${folderName}' 폴더를 삭제하시겠습니까?\n(폴더 안의 앨범들은 '미분류'로 이동됩니다.)`,
                  )
                : true;
        if (!ok) return;

        try {
            await fetch(`${BACKEND_URL}/api/folders/${folderName}`, { method: 'DELETE' });
            if (selectedFolderTab === folderName) setSelectedFolderTab('전체');
            await fetchBackupData();
        } catch (e) {
            alert('폴더 삭제에 실패했습니다.');
        }
    };

    const handleMoveAlbumToFolder = async (albumId: string, folderName: string) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/backup-albums/${albumId}/move`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoryFolder: folderName }),
            });
            if (res.ok) {
                setBackupAlbums((prev) =>
                    prev.map((a) => (a.id === albumId ? { ...a, categoryFolder: folderName } : a)),
                );
                setMovingAlbum(null);
                await fetchBackupData();
            }
        } catch (e) {
            alert('폴더 이동 실패');
        }
    };

    const handleBatchMoveAlbumsToFolder = async (folderName: string) => {
        if (selectedAlbumIds.size === 0) return;
        try {
            setLoading(true);
            const res = await fetch(`${BACKEND_URL}/api/backup-albums/batch-move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    albumIds: Array.from(selectedAlbumIds),
                    categoryFolder: folderName,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                alert(`✨ ${data.movedCount}개의 앨범이 '${folderName}' 폴더로 일괄 이동되었습니다!`);
                setIsBatchMovingOpen(false);
                setSelectedAlbumIds(new Set());
                await fetchBackupData();
                setSelectedFolderTab(folderName);
            }
        } catch (e) {
            alert('일괄 폴더 이동 실패');
        } finally {
            setLoading(false);
        }
    };

    const isAlreadyInIndex = (backupAlbum: BackupAlbumMeta): boolean => {
        return memoryList.some((active) => {
            if (active.id === backupAlbum.id || active.id.includes(backupAlbum.id)) return true;
            if (
                active.analysis?.title &&
                active.analysis.title === backupAlbum.analysis?.title &&
                active.imageUrls.length === backupAlbum.imageUrls.length
            ) {
                return true;
            }
            return false;
        });
    };

    const handleRestoreSingle = async (album: BackupAlbumMeta) => {
        if (isAlreadyInIndex(album)) {
            alert('⚠️ 이미 현재 작업 화면(인덱스 목록)에 추가되어 있는 추억 앨범입니다.');
            return;
        }

        try {
            setLoading(true);
            const res = await fetch(`${BACKEND_URL}/api/backup-albums/${album.id}/restore`, {
                method: 'POST',
            });
            if (res.ok) {
                const data = await res.json();
                appendActiveMemory(data.restoredItem);
                alert('✨ 현재 작업 화면(홈)으로 추억 앨범이 성공적으로 복원되었습니다!');
                handleCloseOrBack();
            } else alert('복원에 실패했습니다.');
        } catch (e) {
            alert('복원 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const handleRollbackToHistoryVersion = async (targetVer: AnalysisVersion) => {
        if (!viewingAlbum) return;
        const ok = window.confirm(
            `이 앨범의 현재 분석 내용을 '버전 ${targetVer.version}'의 내용으로 되돌리시겠습니까?`,
        );
        if (!ok) return;

        try {
            setLoading(true);
            const payload = {
                title: targetVer.title,
                location: targetVer.location,
                yearEstimate: targetVer.yearEstimate,
                description: targetVer.description,
                storyCaption: targetVer.storyCaption,
            };

            const res = await fetch(`${BACKEND_URL}/api/memories/${viewingAlbum.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                const updatedAlbum = {
                    ...viewingAlbum,
                    analysis: {
                        ...viewingAlbum.analysis,
                        ...payload,
                    },
                };
                setViewingAlbum(updatedAlbum);
                await fetchBackupData();
                alert(`✨ 버전 ${targetVer.version}의 내용으로 앨범이 성공적으로 롤백되었습니다!`);
            }
        } catch (err) {
            alert('롤백 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteHistoryFromBackup = async (versionNum: number, e?: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (!viewingAlbum) return;

        const ok = window.confirm(`버전 ${versionNum} 기록을 영구 삭제하시겠습니까?`);
        if (!ok) return;

        try {
            setLoading(true);
            const res = await fetch(`${BACKEND_URL}/api/memories/${viewingAlbum.id}/history/${versionNum}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                const data = await res.json();
                const reorderedHistory: AnalysisVersion[] = data.history || [];
                setViewingAlbum((prev) => (prev ? { ...prev, history: reorderedHistory } : null));
                setBackupAlbums((prevList) =>
                    prevList.map((a) => (a.id === viewingAlbum.id ? { ...a, history: reorderedHistory } : a)),
                );
            }
        } catch (err) {
            alert('히스토리 삭제 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const handleBatchRestore = async () => {
        if (selectedAlbumIds.size === 0) return;
        const selectedAlbums = backupAlbums.filter((album) => selectedAlbumIds.has(album.id));
        const targetToRestore = selectedAlbums.filter((album) => !isAlreadyInIndex(album));

        if (targetToRestore.length === 0) {
            alert('⚠️ 선택한 모든 앨범이 이미 현재 작업 화면(인덱스 목록)에 존재합니다.');
            return;
        }

        try {
            setLoading(true);
            const res = await fetch(`${BACKEND_URL}/api/backup-albums/batch-restore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ albumIds: targetToRestore.map((a) => a.id) }),
            });

            if (res.ok) {
                const data = await res.json();
                appendActiveMemories(data.restoredItems);
                alert(`✨ 선택한 ${data.restoredItems.length}개의 앨범이 복원되었습니다!`);
                setSelectedAlbumIds(new Set());
                handleCloseOrBack();
            }
        } catch (e) {
            alert('일괄 복원 오류');
        } finally {
            setLoading(false);
        }
    };

    const handleBatchDelete = async () => {
        if (selectedAlbumIds.size === 0) return;
        const ok =
            Platform.OS === 'web'
                ? window.confirm(`선택한 ${selectedAlbumIds.size}개의 앨범을 영구 삭제하시겠습니까?`)
                : true;
        if (!ok) return;

        try {
            setLoading(true);
            await fetch(`${BACKEND_URL}/api/backup-albums/batch-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ albumIds: Array.from(selectedAlbumIds) }),
            });
            await fetchBackupData();
            setSelectedAlbumIds(new Set());
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteSingle = async (albumId: string) => {
        const ok = Platform.OS === 'web' ? window.confirm('이 앨범을 영구 삭제하시겠습니까?') : true;
        if (!ok) return;
        try {
            await fetch(`${BACKEND_URL}/api/backup-albums/${albumId}`, { method: 'DELETE' });
            await fetchBackupData();
        } catch (e) {
            alert('삭제 실패');
        }
    };

    const filteredAlbums = backupAlbums.filter((album) => {
        const folderMatch =
            selectedFolderTab === '전체'
                ? true
                : selectedFolderTab === '미분류'
                  ? !album.categoryFolder || album.categoryFolder === '미분류'
                  : album.categoryFolder === selectedFolderTab;

        if (!folderMatch) return false;

        if (!searchKeyword.trim()) return true;
        const kw = searchKeyword.toLowerCase();
        const title = (album.analysis?.title || '').toLowerCase();
        const loc = (album.analysis?.location || '').toLowerCase();
        const desc = (album.analysis?.description || '').toLowerCase();
        return title.includes(kw) || loc.includes(kw) || desc.includes(kw);
    });

    const isAllSelected = filteredAlbums.length > 0 && filteredAlbums.every((item) => selectedAlbumIds.has(item.id));

    return (
        <View style={styles.pageContainer}>
            <View style={styles.modalCard}>
                <View style={styles.headerRow}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.title}>📦 추억 보관함 & 여행지별 폴더 관리</Text>
                        <Text style={styles.subtitle}>
                            오사카, 나고야 등 여행 일정별로 폴더를 생성하여 추억을 체계적으로 분류하고 관리해보세요.
                        </Text>
                    </View>
                    <TouchableOpacity style={styles.closeBtn} onPress={handleCloseOrBack}>
                        <Text style={styles.closeBtnText}>✕</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.folderActionBar}>
                    <View style={styles.searchBox}>
                        <Text style={{ fontSize: 14 }}>🔍</Text>
                        <TextInput
                            style={styles.searchInput}
                            placeholder="제목, 여행지(오사카, 나고야 등), 사연 검색..."
                            placeholderTextColor="#94A3B8"
                            value={searchKeyword}
                            onChangeText={setSearchKeyword}
                        />
                        {searchKeyword.length > 0 && (
                            <TouchableOpacity onPress={() => setSearchKeyword('')}>
                                <Text style={{ color: '#94A3B8', fontSize: 13, fontWeight: '700' }}>✕</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    <TouchableOpacity style={styles.createFolderBtn} onPress={() => setIsFolderModalOpen(true)}>
                        <Text style={styles.createFolderBtnText}>📁 새 폴더 만들기 +</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.folderTabWrapper}>
                    <MouseDragHorizontalScroll contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                        <TouchableOpacity
                            style={[styles.folderTab, selectedFolderTab === '전체' && styles.folderTabActive]}
                            onPress={() => setSelectedFolderTab('전체')}
                        >
                            <Text
                                style={[
                                    styles.folderTabText,
                                    selectedFolderTab === '전체' && styles.folderTabTextActive,
                                ]}
                            >
                                {`🗂️ 전체 (${backupAlbums.length})`}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.folderTab, selectedFolderTab === '미분류' && styles.folderTabActive]}
                            onPress={() => setSelectedFolderTab('미분류')}
                        >
                            <Text
                                style={[
                                    styles.folderTabText,
                                    selectedFolderTab === '미분류' && styles.folderTabTextActive,
                                ]}
                            >
                                {`📄 미분류 (${backupAlbums.filter((a) => !a.categoryFolder || a.categoryFolder === '미분류').length})`}
                            </Text>
                        </TouchableOpacity>

                        {folders.map((fName) => {
                            const count = backupAlbums.filter((a) => a.categoryFolder === fName).length;
                            return (
                                <View key={fName} style={styles.customFolderTabContainer}>
                                    <TouchableOpacity
                                        style={[
                                            styles.folderTab,
                                            selectedFolderTab === fName && styles.folderTabActive,
                                        ]}
                                        onPress={() => setSelectedFolderTab(fName)}
                                    >
                                        <Text
                                            style={[
                                                styles.folderTabText,
                                                selectedFolderTab === fName && styles.folderTabTextActive,
                                            ]}
                                        >
                                            {`📁 ${fName} (${count})`}
                                        </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.folderDeleteSmallBtn}
                                        onPress={() => handleDeleteFolder(fName)}
                                    >
                                        <Text style={{ fontSize: 10, color: '#DC2626' }}>✕</Text>
                                    </TouchableOpacity>
                                </View>
                            );
                        })}
                    </MouseDragHorizontalScroll>
                </View>

                <View style={styles.toolbarRow}>
                    <TouchableOpacity
                        style={styles.selectAllBtn}
                        onPress={() => {
                            if (isAllSelected) setSelectedAlbumIds(new Set());
                            else setSelectedAlbumIds(new Set(filteredAlbums.map((a) => a.id)));
                        }}
                    >
                        <Text style={styles.selectAllBtnText}>{isAllSelected ? '선택 해제 ✕' : '전체 선택 ✓'}</Text>
                    </TouchableOpacity>

                    {selectedAlbumIds.size > 0 && (
                        <View style={styles.batchActionGroup}>
                            <TouchableOpacity style={styles.batchMoveBtn} onPress={() => setIsBatchMovingOpen(true)}>
                                <Text style={styles.batchMoveBtnText}>
                                    {`📁 선택 폴더 이동 (${selectedAlbumIds.size}개)`}
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.batchRestoreBtn} onPress={handleBatchRestore}>
                                <Text style={styles.batchRestoreBtnText}>
                                    {`📥 선택 일괄 복원 (${selectedAlbumIds.size}개)`}
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.batchDeleteBtn} onPress={handleBatchDelete}>
                                <Text style={styles.batchDeleteBtnText}>
                                    {`🗑️ 선택 영구 삭제 (${selectedAlbumIds.size}개)`}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                {loading && (
                    <View style={styles.loadingBox}>
                        <ActivityIndicator size="large" color="#F5933C" />
                        <Text style={styles.loadingText}>보관함 데이터를 처리하는 중...</Text>
                    </View>
                )}

                {!loading && fetchError && (
                    <View style={styles.emptyBox}>
                        <Text style={styles.emptyIcon}>🔌</Text>
                        <Text style={styles.emptyTitle}>백엔드 서버에 연결할 수 없습니다.</Text>
                        <TouchableOpacity style={styles.retryBtn} onPress={fetchBackupData}>
                            <Text style={styles.retryBtnText}>🔄 다시 시도</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {!loading && !fetchError && filteredAlbums.length === 0 && (
                    <View style={styles.emptyBox}>
                        <Text style={styles.emptyIcon}>📂</Text>
                        <Text style={styles.emptyTitle}>
                            {searchKeyword
                                ? `'${searchKeyword}'에 대한 검색 결과가 없습니다.`
                                : '해당 폴더에 앨범이 없습니다.'}
                        </Text>
                    </View>
                )}

                {!loading && !fetchError && filteredAlbums.length > 0 && (
                    <ScrollView style={styles.albumListScroll} contentContainerStyle={styles.albumListContent}>
                        {filteredAlbums.map((album) => {
                            const isSelected = selectedAlbumIds.has(album.id);
                            const isAlreadyPresent = isAlreadyInIndex(album);

                            return (
                                <View key={album.id} style={[styles.albumCard, isSelected && styles.albumCardSelected]}>
                                    <TouchableOpacity
                                        style={[styles.checkbox, isSelected && styles.checkboxActive]}
                                        onPress={() => {
                                            setSelectedAlbumIds((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(album.id)) next.delete(album.id);
                                                else next.add(album.id);
                                                return next;
                                            });
                                        }}
                                    >
                                        <Text style={[styles.checkmark, isSelected && styles.checkmarkActive]}>
                                            {isSelected ? '✓' : ''}
                                        </Text>
                                    </TouchableOpacity>

                                    <View style={styles.albumInfoWrapper}>
                                        <MouseDragHorizontalScroll contentContainerStyle={styles.thumbScroll}>
                                            {album.imageUrls.map((mediaUrl, i) => {
                                                const isVid = isVideoUrl(mediaUrl);
                                                return (
                                                    <View key={i} style={{ position: 'relative' }}>
                                                        {isVid && Platform.OS === 'web' ? (
                                                            <div
                                                                style={{
                                                                    width: 70,
                                                                    height: 50,
                                                                    position: 'relative',
                                                                    backgroundColor: '#000',
                                                                    borderRadius: 6,
                                                                    overflow: 'hidden',
                                                                }}
                                                            >
                                                                <video
                                                                    src={mediaUrl}
                                                                    style={{
                                                                        width: '100%',
                                                                        height: '100%',
                                                                        objectFit: 'cover',
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
                                                                        backgroundColor: 'rgba(0,0,0,0.3)',
                                                                    }}
                                                                >
                                                                    <span style={{ fontSize: 12 }}>🎬</span>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <Image
                                                                source={{ uri: mediaUrl }}
                                                                style={styles.thumbImg}
                                                                resizeMode="cover"
                                                            />
                                                        )}
                                                    </View>
                                                );
                                            })}
                                        </MouseDragHorizontalScroll>

                                        <View style={styles.metaRow}>
                                            <View style={{ flex: 1 }}>
                                                <View
                                                    style={{
                                                        flexDirection: 'row',
                                                        alignItems: 'center',
                                                        gap: 6,
                                                        flexWrap: 'wrap',
                                                    }}
                                                >
                                                    <Text style={styles.albumTitle}>
                                                        {album.analysis?.title || '이름 없는 추억'}
                                                    </Text>
                                                    <View style={styles.folderTag}>
                                                        <Text
                                                            style={styles.folderTagText}
                                                        >{`📁 ${album.categoryFolder || '미분류'}`}</Text>
                                                    </View>
                                                    {album.history && album.history.length > 0 && (
                                                        <View style={styles.historyBadge}>
                                                            <Text
                                                                style={styles.historyBadgeText}
                                                            >{`📜 버전 ${album.history.length}개 보관`}</Text>
                                                        </View>
                                                    )}
                                                    {isAlreadyPresent && (
                                                        <View style={styles.alreadyBadge}>
                                                            <Text style={styles.alreadyBadgeText}>
                                                                현재 홈에 존재함
                                                            </Text>
                                                        </View>
                                                    )}
                                                </View>
                                                <Text style={styles.albumSub}>
                                                    {`📍 ${album.analysis?.location || '장소 미정'} · ⏳ ${album.analysis?.yearEstimate || '시기 미정'} · 🖼️ 미디어 ${album.imageUrls.length}개`}
                                                </Text>
                                            </View>

                                            <View style={styles.cardBtnGroup}>
                                                <TouchableOpacity
                                                    style={styles.moveFolderBtn}
                                                    onPress={() => setMovingAlbum(album)}
                                                >
                                                    <Text style={styles.moveFolderBtnText}>📁 폴더 이동</Text>
                                                </TouchableOpacity>

                                                <TouchableOpacity
                                                    style={styles.detailBtn}
                                                    onPress={() => setViewingAlbum(album)}
                                                >
                                                    <Text style={styles.detailBtnText}>👁️ 상세 보기</Text>
                                                </TouchableOpacity>

                                                <TouchableOpacity
                                                    style={[
                                                        styles.restoreSingleBtn,
                                                        isAlreadyPresent && styles.restoreSingleBtnDisabled,
                                                    ]}
                                                    onPress={() => handleRestoreSingle(album)}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.restoreSingleBtnText,
                                                            isAlreadyPresent && styles.restoreSingleBtnTextDisabled,
                                                        ]}
                                                    >
                                                        {isAlreadyPresent ? '✓ 홈에 있음' : '📥 홈으로 복원'}
                                                    </Text>
                                                </TouchableOpacity>

                                                <TouchableOpacity
                                                    style={styles.deleteSingleBtn}
                                                    onPress={() => handleDeleteSingle(album.id)}
                                                >
                                                    <Text style={styles.deleteSingleBtnText}>🗑️ 영구 삭제</Text>
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                    </View>
                                </View>
                            );
                        })}
                    </ScrollView>
                )}

                {/* 🌟 분리된 모달 컴포넌트들 연결 */}
                <CreateFolderModal
                    visible={isFolderModalOpen}
                    onClose={() => setIsFolderModalOpen(false)}
                    onCreate={handleCreateFolder}
                />

                <MoveFolderModal
                    visible={movingAlbum !== null}
                    title="📁 앨범 폴더 변경"
                    subtitle={`'${movingAlbum?.analysis?.title}' 앨범을 이동할 폴더를 선택해주세요.`}
                    currentFolder={movingAlbum?.categoryFolder}
                    folders={folders}
                    onClose={() => setMovingAlbum(null)}
                    onSelectFolder={(f) => movingAlbum && handleMoveAlbumToFolder(movingAlbum.id, f)}
                />

                <MoveFolderModal
                    visible={isBatchMovingOpen}
                    title="📁 선택한 앨범 일괄 폴더 이동"
                    subtitle={`선택한 ${selectedAlbumIds.size}개의 앨범을 일괄 이동할 대상 폴더를 선택해주세요.`}
                    folders={folders}
                    onClose={() => setIsBatchMovingOpen(false)}
                    onSelectFolder={handleBatchMoveAlbumsToFolder}
                />

                <BackupDetailViewerModal
                    album={viewingAlbum}
                    isAlreadyInIndex={viewingAlbum ? isAlreadyInIndex(viewingAlbum) : false}
                    onClose={() => setViewingAlbum(null)}
                    onRestoreToHome={handleRestoreSingle}
                    onRollbackVersion={handleRollbackToHistoryVersion}
                    onDeleteHistoryVersion={handleDeleteHistoryFromBackup}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    pageContainer: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    modalCard: {
        width: '100%',
        maxWidth: 980,
        height: '92%',
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 24,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
        paddingBottom: 14,
        marginBottom: 12,
    },
    title: { fontSize: 20, fontWeight: '800', color: '#1A1A1A' },
    subtitle: { fontSize: 13, color: '#71717A', marginTop: 4 },
    closeBtn: {
        padding: 8,
        backgroundColor: '#F4F4F5',
        borderRadius: 20,
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
    },
    closeBtnText: { fontSize: 16, color: '#52525B', fontWeight: '800', lineHeight: 18 },
    folderActionBar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 10,
        alignItems: 'center',
    },
    searchBox: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 8,
        paddingHorizontal: 12,
        height: 40,
        gap: 8,
    },
    searchInput: { flex: 1, fontSize: 13, color: '#1E293B', outlineStyle: 'none' as any },
    createFolderBtn: {
        backgroundColor: '#0F172A',
        paddingHorizontal: 14,
        height: 40,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    createFolderBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    folderTabWrapper: {
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
        paddingBottom: 8,
        marginBottom: 12,
    },
    folderTab: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
        backgroundColor: '#F1F5F9',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    folderTabActive: { backgroundColor: '#F5933C', borderColor: '#F5933C' },
    folderTabText: { fontSize: 12, color: '#475569', fontWeight: '700' },
    folderTabTextActive: { color: '#FFFFFF' },
    customFolderTabContainer: { flexDirection: 'row', alignItems: 'center', position: 'relative' },
    folderDeleteSmallBtn: {
        marginLeft: -6,
        marginRight: 4,
        backgroundColor: '#FEE2E2',
        borderRadius: 10,
        width: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 5,
    },
    toolbarRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        flexWrap: 'wrap',
        gap: 8,
    },
    selectAllBtn: {
        paddingVertical: 6,
        paddingHorizontal: 10,
        backgroundColor: '#F4F4F5',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E4E4E7',
    },
    selectAllBtnText: { fontSize: 12, color: '#3F3F46', fontWeight: '700' },
    batchActionGroup: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    batchMoveBtn: {
        backgroundColor: '#2563EB',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    batchMoveBtnText: { fontSize: 12, color: '#FFFFFF', fontWeight: '700' },
    batchRestoreBtn: {
        backgroundColor: '#F5933C',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    batchRestoreBtnText: { fontSize: 12, color: '#FFFFFF', fontWeight: '700' },
    batchDeleteBtn: {
        backgroundColor: '#FEE2E2',
        borderWidth: 1,
        borderColor: '#FCA5A5',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    batchDeleteBtnText: { fontSize: 12, color: '#DC2626', fontWeight: '700' },
    loadingBox: { alignItems: 'center', marginVertical: 40 },
    loadingText: { marginTop: 12, fontSize: 14, color: '#71717A' },
    emptyBox: { alignItems: 'center', marginVertical: 40 },
    emptyIcon: { fontSize: 40, marginBottom: 12 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: '#3F3F46' },
    retryBtn: {
        marginTop: 16,
        backgroundColor: '#F5933C',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
    },
    retryBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    albumListScroll: { flex: 1 },
    albumListContent: { gap: 14, paddingBottom: 20 },
    albumCard: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: '#E4E4E7',
        borderRadius: 12,
        padding: 16,
        backgroundColor: '#FAFAFA',
        gap: 16,
    },
    albumCardSelected: { borderColor: '#F5933C', backgroundColor: '#FFFDF9' },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 1.5,
        borderColor: '#A1A1AA',
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkboxActive: { backgroundColor: '#F5933C', borderColor: '#F5933C' },
    checkmark: { fontSize: 12, color: 'transparent', fontWeight: '800' },
    checkmarkActive: { color: '#FFFFFF' },
    albumInfoWrapper: { flex: 1, gap: 10 },
    thumbScroll: { flexDirection: 'row', gap: 8 },
    thumbImg: { width: 70, height: 50, borderRadius: 6, backgroundColor: '#E4E4E7' },
    metaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
    },
    albumTitle: { fontSize: 16, fontWeight: '700', color: '#18181B' },
    folderTag: {
        backgroundColor: '#FEF3C7',
        borderWidth: 1,
        borderColor: '#FDE68A',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    folderTagText: { fontSize: 11, color: '#B45309', fontWeight: '700' },
    historyBadge: {
        backgroundColor: '#F3E8FF',
        borderWidth: 1,
        borderColor: '#E9D5FF',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    historyBadgeText: { fontSize: 11, color: '#7E22CE', fontWeight: '700' },
    alreadyBadge: {
        backgroundColor: '#E0F2FE',
        borderWidth: 1,
        borderColor: '#BAE6FD',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    alreadyBadgeText: { fontSize: 11, color: '#0369A1', fontWeight: '700' },
    albumSub: { fontSize: 12, color: '#71717A', marginTop: 2 },
    cardBtnGroup: { flexDirection: 'row', gap: 6 },
    moveFolderBtn: {
        backgroundColor: '#EFF6FF',
        borderWidth: 1,
        borderColor: '#BFDBFE',
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 6,
    },
    moveFolderBtnText: { fontSize: 12, fontWeight: '700', color: '#1D4ED8' },
    detailBtn: {
        backgroundColor: '#F4F4F5',
        borderWidth: 1,
        borderColor: '#E4E4E7',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
    },
    detailBtnText: { fontSize: 12, fontWeight: '700', color: '#3F3F46' },
    restoreSingleBtn: {
        backgroundColor: '#F5933C',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
    },
    restoreSingleBtnDisabled: { backgroundColor: '#E4E4E7', borderWidth: 1, borderColor: '#D4D4D8' },
    restoreSingleBtnText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
    restoreSingleBtnTextDisabled: { color: '#71717A' },
    deleteSingleBtn: {
        backgroundColor: '#FEE2E2',
        borderWidth: 1,
        borderColor: '#FCA5A5',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
    },
    deleteSingleBtnText: { fontSize: 12, fontWeight: '700', color: '#DC2626' },
});
