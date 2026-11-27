export const PostLoginEvent = { Output: 'post-login:output' } as const;

export type PostLoginOutput =
    | { readonly kind: 'status'; readonly message: string }
    | { readonly kind: 'progress'; readonly ratio: number }
    | { readonly kind: 'navigate'; readonly route: string }
    | { readonly kind: 'failed'; readonly error: unknown };
