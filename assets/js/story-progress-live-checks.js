(function initStoryProgressLiveChecks(root, factory) {
    const api = factory();
    root.storyProgressLiveChecks = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : window, function createStoryProgressLiveChecks() {
    function normalizeStoryReadySceneIds(sceneIds = []) {
        const seen = new Set();
        return (Array.isArray(sceneIds) ? sceneIds : [])
            .map((sceneId) => String(sceneId || '').trim())
            .filter((sceneId) => {
                if (!sceneId || seen.has(sceneId)) return false;
                seen.add(sceneId);
                return true;
            });
    }

    function isStorySceneReady(runtimeEntry = null, scene = null) {
        if (runtimeEntry?.completed) return true;
        if (!scene || !scene.advanceOn) return true;
        const sceneId = String(scene?.id || '').trim();
        if (!sceneId) return true;
        const readySceneIds = normalizeStoryReadySceneIds(runtimeEntry?.readySceneIds);
        return readySceneIds.includes(sceneId);
    }

    function markStorySceneReady(runtimeEntry = null, sceneId = '') {
        const normalizedSceneId = String(sceneId || '').trim();
        const readySceneIds = normalizeStoryReadySceneIds(runtimeEntry?.readySceneIds);
        if (!normalizedSceneId) {
            return {
                readySceneIds,
                hasChanges: false,
                isReady: true
            };
        }

        if (readySceneIds.includes(normalizedSceneId)) {
            return {
                readySceneIds,
                hasChanges: false,
                isReady: true
            };
        }

        return {
            readySceneIds: [...readySceneIds, normalizedSceneId],
            hasChanges: true,
            isReady: true
        };
    }

    function advanceStoryProgress(options = {}) {
        const storyIds = Array.isArray(options.storyIds)
            ? options.storyIds.map((storyId) => String(storyId || '').trim()).filter(Boolean)
            : [];
        const activeStoryId = String(options.activeStoryId || '').trim();
        const activeStoryIndex = storyIds.indexOf(activeStoryId);
        const sceneCount = Math.max(0, Number(options.sceneCount) || 0);
        const lastSceneIndex = Math.max(0, sceneCount - 1);
        const rawSceneIndex = Number(options.sceneIndex);
        const sceneIndex = Number.isFinite(rawSceneIndex)
            ? Math.max(0, Math.min(lastSceneIndex, Math.floor(rawSceneIndex)))
            : 0;
        const currentSceneReady = Boolean(options.currentSceneReady);

        if (!currentSceneReady) {
            return {
                allowed: false,
                completedStory: Boolean(options.completedStory),
                nextStoryId: activeStoryId,
                nextSceneIndex: sceneIndex,
                openedNextStory: false,
                reachedStoryEnd: false
            };
        }

        if (sceneCount > 0 && sceneIndex < lastSceneIndex) {
            return {
                allowed: true,
                completedStory: false,
                nextStoryId: activeStoryId,
                nextSceneIndex: sceneIndex + 1,
                openedNextStory: false,
                reachedStoryEnd: false
            };
        }

        const nextStoryId = activeStoryIndex >= 0 && activeStoryIndex < storyIds.length - 1
            ? storyIds[activeStoryIndex + 1]
            : activeStoryId;

        return {
            allowed: true,
            completedStory: true,
            nextStoryId,
            nextSceneIndex: 0,
            openedNextStory: nextStoryId !== activeStoryId,
            reachedStoryEnd: true
        };
    }

    return {
        normalizeStoryReadySceneIds,
        isStorySceneReady,
        markStorySceneReady,
        advanceStoryProgress
    };
}));
