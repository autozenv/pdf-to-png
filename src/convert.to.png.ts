import { Canvas, CanvasRenderingContext2D } from 'canvas';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { parse, resolve } from 'path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf';
import * as pdfApiTypes from 'pdfjs-dist/types/src/display/api';
import * as pdfDisplayUtilsTypes from 'pdfjs-dist/types/src/display/display_utils';
import { CanvasContext, NodeCanvasFactory } from './node.canvas.factory';

const cMapUrl = '../node_modules/pdfjs-dist/cmaps/';
const cMapPacked = true;

export const VerbosityLevel = {
    ERRORS: 0,
    WARNINGS: 1,
    INFOS: 5,
};

export const PDF_TO_PNG_OPTIONS_DEFAULTS: PdfToPngOptions = {
    viewportScale: 1,
    disableFontFace: true,
    useSystemFonts: false,
    outputFileMask: 'buffer',
    strictPagesToProcess: false,
};

export type PdfToPngOptions = {
    viewportScale?: number;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
    pdfFilePassword?: string;
    outputFolder?: string;
    outputFileMask?: string;
    pagesToProcess?: number[];
    strictPagesToProcess?: boolean;
    verbosityLevel?: number;
};

export type PngPageOutput = {
    name: string;
    content: Buffer;
    path: string;
};

export async function pdfToPng(
    pdfFilePathOrBuffer: string | ArrayBufferLike,
    props?: PdfToPngOptions,
): Promise<PngPageOutput[]> {
    const isBuffer: boolean = Buffer.isBuffer(pdfFilePathOrBuffer);

    if (!isBuffer && !existsSync(pdfFilePathOrBuffer as string)) {
        throw Error(`PDF file not found on: ${pdfFilePathOrBuffer}.`);
    }

    if (props?.outputFolder && !existsSync(props.outputFolder)) {
        mkdirSync(props.outputFolder, { recursive: true });
    }

    const pdfFileBuffer: ArrayBuffer = isBuffer
        ? (pdfFilePathOrBuffer as ArrayBuffer)
        : readFileSync(pdfFilePathOrBuffer as string);

    const pdfDocInitParams: pdfApiTypes.DocumentInitParameters = {
        data: new Uint8Array(pdfFileBuffer),
        cMapUrl,
        cMapPacked,
        verbosity: props?.verbosityLevel ?? VerbosityLevel.ERRORS,
    };

    pdfDocInitParams.disableFontFace = props?.disableFontFace
        ? props.disableFontFace
        : PDF_TO_PNG_OPTIONS_DEFAULTS.disableFontFace;

    pdfDocInitParams.useSystemFonts = props?.useSystemFonts
        ? props.useSystemFonts
        : PDF_TO_PNG_OPTIONS_DEFAULTS.useSystemFonts;

    if (props?.pdfFilePassword) {
        pdfDocInitParams.password = props.pdfFilePassword;
    }

    const pdfDocument: pdfApiTypes.PDFDocumentProxy = await pdfjs.getDocument(pdfDocInitParams).promise;
    const pngPagesOutput: PngPageOutput[] = [];

    const targetedPages: number[] = props?.pagesToProcess
        ? props.pagesToProcess
        : Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);

    if (props?.strictPagesToProcess && targetedPages.some((pageNum) => pageNum < 1)) {
        throw new Error('Invalid pages requested, page numbers must be >= 1');
    }

    if (props?.strictPagesToProcess && targetedPages.some((pageNum) => pageNum > pdfDocument.numPages)) {
        throw new Error('Invalid pages requested, page numbers must be <= total pages');
    }

    for (const pageNumber of targetedPages) {
        if (pageNumber > pdfDocument.numPages || pageNumber < 1) {
            // If a requested page is beyond the PDF bounds we skip it.
            // This allows the use case "generate up to the first n pages from a set of input PDFs"
            continue;
        }
        const page: pdfApiTypes.PDFPageProxy = await pdfDocument.getPage(pageNumber);
        const viewport: pdfDisplayUtilsTypes.PageViewport = page.getViewport({
            scale: props?.viewportScale ? props.viewportScale : (PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale as number),
        });
        const canvasFactory = new NodeCanvasFactory();
        const canvasAndContext: CanvasContext = canvasFactory.create(viewport.width, viewport.height);

        const renderContext: pdfApiTypes.RenderParameters = {
            canvasContext: canvasAndContext.context as CanvasRenderingContext2D,
            viewport,
            canvasFactory,
        };

        await page.render(renderContext).promise;

        let pageName;
        if (props?.outputFileMask) {
            pageName = props.outputFileMask;
        }
        if (!pageName && !isBuffer) {
            pageName = parse(pdfFilePathOrBuffer as string).name;
        }
        if (!pageName) {
            pageName = PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask;
        }
        const pngPageOutput: PngPageOutput = {
            name: `${pageName}_page_${pageNumber}.png`,
            content: (canvasAndContext.canvas as Canvas).toBuffer(),
            path: '',
        };

        if (props?.outputFolder) {
            pngPageOutput.path = resolve(props.outputFolder, pngPageOutput.name);
            writeFileSync(pngPageOutput.path, pngPageOutput.content);
        }

        pngPagesOutput.push(pngPageOutput);
    }

    return pngPagesOutput;
}
