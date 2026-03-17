class LayoutManager {
    constructor() {
        this.resizingInfo = null;
        this.handles = document.querySelectorAll('.resizer-handle');
        this.minDrawerRatio = 0.01;
        this.init();
    }

    init() {
        this.handles.forEach(handle => {
            handle.addEventListener('mousedown', (e) => this.startResizing(e, handle));
        });

        window.addEventListener('mousemove', (e) => this.resize(e));
        window.addEventListener('mouseup', () => this.stopResizing());
    }

    startResizing(e, handle) {
        e.preventDefault();
        const targetId = handle.dataset.target; // 'left', 'right', 'bottom'
        const targetElement = document.getElementById(targetId + '-drawer');

        if (!targetElement) {
            console.error(`LayoutManager: Target element #${targetId}-drawer not found!`);
            return;
        }

        this.resizingInfo = {
            target: targetElement,
            type: targetId, // 'left' | 'right' | 'bottom'
            startX: e.clientX,
            startY: e.clientY,
            startWidth: parseFloat(getComputedStyle(targetElement).width),
            startHeight: parseFloat(getComputedStyle(targetElement).height)
        };

        handle.classList.add('resizing');
        document.body.style.cursor = targetId === 'bottom' ? 'row-resize' : 'col-resize';
        document.body.style.userSelect = 'none'; // Prevent text selection
    }

    resize(e) {
        if (!this.resizingInfo) return;

        const { target, type, startX, startY, startWidth, startHeight } = this.resizingInfo;
        const currentX = e.clientX;
        const currentY = e.clientY;
        const minSidebarWidth = Math.max(10, Math.round(window.innerWidth * this.minDrawerRatio));
        const maxSidebarWidth = Math.max(minSidebarWidth, Math.round(window.innerWidth / 2));
        const minBottomHeight = 100;
        const minMainAreaHeight = Math.max(64, Math.round(window.innerHeight * 0.08));
        const maxBottomHeight = Math.max(minBottomHeight, window.innerHeight - minMainAreaHeight);

        if (type === 'left') {
            const newWidth = this.clamp(startWidth + (currentX - startX), minSidebarWidth, maxSidebarWidth);
            target.style.width = `${newWidth}px`;
        } else if (type === 'right') {
            const newWidth = this.clamp(startWidth - (currentX - startX), minSidebarWidth, maxSidebarWidth);
            target.style.width = `${newWidth}px`;
        } else if (type === 'bottom') {
            const newHeight = this.clamp(startHeight - (currentY - startY), minBottomHeight, maxBottomHeight);
            target.style.height = `${newHeight}px`;
            // Refresh CodeMirror if it exists
            if (window.sqlEditorInstance) {
                window.sqlEditorInstance.refresh();
            }
        }
    }

    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    stopResizing() {
        if (this.resizingInfo) {
            const handle = document.querySelector(`.resizer-handle[data-target="${this.resizingInfo.type}"]`);
            if (handle) handle.classList.remove('resizing');

            this.resizingInfo = null;
            document.body.style.cursor = 'default';
            document.body.style.userSelect = '';
        }
    }
}

// Initialize on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    new LayoutManager();
});
