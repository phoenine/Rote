import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';

export function ArticleMarkdown({ content }: { content: string }) {
  return (
    <PhotoProvider>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) =>
            typeof src === 'string' && src ? (
              <PhotoView src={src}>
                <img
                  src={src}
                  alt={alt || ''}
                  loading="lazy"
                  className="h-auto max-w-full cursor-zoom-in"
                />
              </PhotoView>
            ) : null,
        }}
      >
        {content}
      </ReactMarkdown>
    </PhotoProvider>
  );
}
