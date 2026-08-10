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

    func testBearerRequestAndCommonErrorBody() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        let client = MobileAPIClient(
            baseURL: URL(string: "https://briar-api.example/base")!,
            session: session
        )
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://briar-api.example/base/me")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
            return (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 403,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data(#"{"message":"permission denied"}"#.utf8)
            )
        }

        do {
            let _: CurrentUserResponse = try await client.get("/me", token: "secret")
            XCTFail("Expected an HTTP error")
        } catch let MobileAPIError.httpStatus(status, message) {
            XCTAssertEqual(status, 403)
            XCTAssertEqual(message, "permission denied")
        }
    }

    func testSendVoidUsesSharedJSONTransportAndHTTPErrorContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let client = MobileAPIClient(
            baseURL: URL(string: "https://briar-api.example/base")!,
            session: URLSession(configuration: configuration)
        )
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://briar-api.example/base/action")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            let body = try XCTUnwrap(
                JSONSerialization.jsonObject(with: try request.bodyData()) as? [String: Bool]
            )
            XCTAssertEqual(body, ["enabled": true])
            return (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 204,
                    httpVersion: nil,
                    headerFields: nil
                )!,
                Data()
            )
        }

        try await client.sendVoid(
            "/action",
            method: "POST",
            token: "secret",
            body: VoidRequest(enabled: true)
        )

        URLProtocolStub.handler = { request in
            (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 409,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data(#"{"error":"already applied"}"#.utf8)
            )
        }
        do {
            try await client.sendVoid(
                "/action",
                method: "POST",
                token: "secret",
                body: nil
            )
            XCTFail("Expected the shared HTTP status validator to reject 409")
        } catch let MobileAPIError.httpStatus(status, message) {
            XCTAssertEqual(status, 409)
            XCTAssertEqual(message, "already applied")
        }
    }

    func testMultipartUploadUsesBearerAndFileMetadata() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let client = MobileAPIClient(
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
private struct VoidRequest: Codable, Sendable { let enabled: Bool }

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
