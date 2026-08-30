import Foundation
import XCTest
@testable import BriarCompanion

final class CoreAPITests: XCTestCase {
    override func tearDown() {
        URLProtocolStub.handler = nil
        super.tearDown()
    }

    func testMobileAPIErrorSurfacesReadableDescriptions() {
        XCTAssertEqual(
            MobileAPIError.httpStatus(400, "Invalid request").localizedDescription,
            "Invalid request"
        )
        XCTAssertEqual(
            MobileAPIError.httpStatus(401, "Unauthorized").localizedDescription,
            "세션이 만료되었습니다. 다시 로그인해 주세요."
        )
        XCTAssertFalse(
            MobileAPIError.invalidResponse.localizedDescription.contains("MobileAPIError")
        )
    }

    func testMultipartUploadUsesBearerAndFileMetadata() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let client = MobileHTTPClient(
            baseURL: URL(string: "https://briar-api.example")!,
            session: URLSession(configuration: configuration)
        )
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
            let body = String(decoding: try request.bodyData(), as: UTF8.self)
            XCTAssertTrue(body.contains("name=\"title\""))
            XCTAssertTrue(body.contains("filename=\"note.txt\""))
            XCTAssertTrue(body.contains("hello"))
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                Data(#"{"ok":true}"#.utf8)
            )
        }

        let response: UploadResponse = try await client.upload(
            "/upload",
            fields: ["title": "Example"],
            files: [MultipartFile(
                fieldName: "file",
                filename: "note.txt",
                contentType: "text/plain",
                data: Data("hello".utf8)
            )],
            token: "token"
        )
        XCTAssertTrue(response.ok)
    }

}

private struct UploadResponse: Codable { let ok: Bool }

private extension URLRequest {
    func bodyData() throws -> Data {
        if let httpBody { return httpBody }
        guard let httpBodyStream else { return Data() }

        httpBodyStream.open()
        defer { httpBodyStream.close() }
        var body = Data()
        let bufferSize = 4_096
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }
        while httpBodyStream.hasBytesAvailable {
            let count = httpBodyStream.read(buffer, maxLength: bufferSize)
            if count < 0 { throw httpBodyStream.streamError ?? URLError(.cannotDecodeContentData) }
            if count == 0 { break }
            body.append(buffer, count: count)
        }
        return body
    }
}

private final class URLProtocolStub: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let (response, data) = try XCTUnwrap(Self.handler)(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
