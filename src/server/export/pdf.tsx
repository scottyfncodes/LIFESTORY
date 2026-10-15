import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { BookModel } from "./manuscript";

/**
 * Typesets the book with the built-in Times family so export never depends
 * on fetching fonts. Page numbers render in a fixed footer.
 */
const styles = StyleSheet.create({
  page: { paddingTop: 72, paddingBottom: 72, paddingHorizontal: 72, fontFamily: "Times-Roman", fontSize: 11.5, color: "#221d18" },
  titlePage: { paddingTop: 200, paddingHorizontal: 72, fontFamily: "Times-Roman", color: "#221d18" },
  title: { fontSize: 30, textAlign: "center", marginBottom: 18 },
  byline: { fontSize: 14, textAlign: "center", color: "#4f4740" },
  generated: { position: "absolute", bottom: 60, left: 72, right: 72, fontSize: 9, textAlign: "center", color: "#7a7067" },
  contentsHeading: { fontSize: 18, marginBottom: 18, textAlign: "center" },
  contentsLine: { fontSize: 12, marginBottom: 6, lineHeight: 1.4 },
  chapterNumber: { fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#7a7067", textAlign: "center", marginTop: 60 },
  chapterTitle: { fontSize: 22, textAlign: "center", marginTop: 8, marginBottom: 6 },
  chapterSubtitle: { fontSize: 12, textAlign: "center", color: "#4f4740", marginBottom: 24, fontFamily: "Times-Italic" },
  spacer: { marginBottom: 28 },
  // lineHeight lives on paragraphs: a page-level lineHeight combined with
  // fixed render-prop footers triggers a layout bug in @react-pdf 4.x.
  paragraph: { marginBottom: 9, lineHeight: 1.55 },
  footer: { position: "absolute", bottom: 40, left: 72, right: 72, fontSize: 9, textAlign: "center", color: "#7a7067" },
  running: { position: "absolute", top: 40, left: 72, right: 72, fontSize: 9, textAlign: "center", color: "#7a7067", fontFamily: "Times-Italic" },
});

function BookDocument({ book }: { book: BookModel }) {
  return (
    <Document title={book.title} author={book.narratorName} creator="LifeStory" producer="LifeStory">
      <Page size="A5" style={styles.titlePage}>
        <Text style={styles.title}>{book.title}</Text>
        <Text style={styles.byline}>by {book.narratorName}</Text>
        <Text style={styles.generated}>Prepared with LifeStory on {book.generatedAt.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}</Text>
      </Page>
      {book.chapters.length > 1 ? (
        <Page size="A5" style={styles.page}>
          <Text style={styles.contentsHeading}>Contents</Text>
          {book.chapters.map((c, i) => (
            <Text key={i} style={styles.contentsLine}>
              {i + 1}. {c.title}
            </Text>
          ))}
          <Text style={styles.footer} render={({ pageNumber }) => String(pageNumber)} fixed />
        </Page>
      ) : null}
      {book.chapters.map((chapter, i) => (
        <Page key={i} size="A5" style={styles.page}>
          <Text style={styles.running} fixed>{book.title}</Text>
          <Text style={styles.chapterNumber}>Chapter {i + 1}</Text>
          <Text style={styles.chapterTitle}>{chapter.title}</Text>
          {chapter.subtitle ? <Text style={styles.chapterSubtitle}>{chapter.subtitle}</Text> : <View style={styles.spacer} />}
          {chapter.paragraphs.map((p, j) => (
            <Text key={j} style={styles.paragraph}>
              {p}
            </Text>
          ))}
          <Text style={styles.footer} render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`} fixed />
        </Page>
      ))}
    </Document>
  );
}

export async function renderBookPdf(book: BookModel): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<BookDocument book={book} />);
  return new Uint8Array(buffer);
}
