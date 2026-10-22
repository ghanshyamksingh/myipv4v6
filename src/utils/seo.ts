export interface FAQItem {
  question: string;
  answer: string;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface ArticleData {
  title: string;
  description: string;
  publishedAt: string;
  authorName?: string;
  url: string;
  imageUrl?: string;
}

export function generateWebApplicationSchema(siteUrl: string = 'https://myipv4v6.com') {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'myipv4v6.com',
    alternateName: 'What is My IP - IPv4 and IPv6 Lookup Tool',
    applicationCategory: 'NetworkingApplication',
    operatingSystem: 'All',
    url: siteUrl,
    description:
      'Instantly detect your public IPv4 and IPv6 address with deep network intelligence, geolocation, ISP, ASN, and privacy diagnostics.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: [
      'Dual-stack IPv4 and IPv6 instant detection',
      'Accurate geolocation with city and region coordinates',
      'Autonomous System Number (ASN) and ISP identification',
      'Local time, timezone, and reverse DNS lookup',
      'Zero tracking and privacy-first architecture',
    ],
  };
}

export function generateFAQSchema(faqs: FAQItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

export function generateBreadcrumbSchema(items: BreadcrumbItem[], siteUrl: string = 'https://myipv4v6.com') {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url.startsWith('http') ? item.url : `${siteUrl}${item.url.startsWith('/') ? '' : '/'}${item.url}`,
    })),
  };
}

export function generateArticleSchema(article: ArticleData, siteUrl: string = 'https://myipv4v6.com') {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    dateModified: article.publishedAt,
    url: article.url.startsWith('http') ? article.url : `${siteUrl}${article.url}`,
    image: article.imageUrl ? [article.imageUrl] : [`${siteUrl}/og-default.png`],
    author: {
      '@type': 'Person',
      name: article.authorName || 'myipv4v6 Network Team',
    },
    publisher: {
      '@type': 'Organization',
      name: 'myipv4v6.com',
      url: siteUrl,
      logo: {
        '@type': 'ImageObject',
        url: `${siteUrl}/favicon.svg`,
      },
    },
  };
}
