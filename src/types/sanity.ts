export interface SanitySeo {
  metaTitle?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  ogImage?: {
    asset?: {
      _ref?: string;
      url?: string;
    };
    alt?: string;
  };
  noIndex?: boolean;
  keywords?: string[];
}

export interface SanityAuthor {
  name: string;
  slug?: { current: string };
  image?: any;
  bio?: string;
}

export interface SanityPost {
  _id: string;
  _type: 'post';
  title: string;
  slug: { current: string };
  excerpt?: string;
  mainImage?: any;
  publishedAt: string;
  author?: SanityAuthor;
  body?: any[];
  seo?: SanitySeo;
  readTimeMinutes?: number;
}

export interface SanityPage {
  _id: string;
  _type: 'page';
  title: string;
  slug: { current: string };
  subtitle?: string;
  body?: any[];
  lastUpdated?: string;
  seo?: SanitySeo;
}

export interface SanityFaq {
  _id: string;
  _type: 'faq';
  question: string;
  answer: string;
  category?: string;
  order?: number;
}
