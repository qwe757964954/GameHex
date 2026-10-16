
/**
 * 可销毁对象
 */
interface destroyable {
    /**是否不可用 */
    disabled?: boolean;

    /**销毁 */
    destroyed: boolean;
    destroy(): void;
}

