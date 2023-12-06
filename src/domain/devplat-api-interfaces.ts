// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TODO: publish logic to get provider auth
import { /* ProviderAuth */ Template } from '@developer-platform/entities';
import { JSONSchema7 } from 'json-schema';
export interface PropDetail extends JSONSchema7 {
    name: string;
    isRequired: boolean;
}

export interface ProviderAuthInfo {
    realm: string;
    authorization_uri: string;
    scopes: string;
}

export interface DevPlatApiResult {
    success: boolean;
    status: number;
    retryAfter?: number;
    additionalAuthRequested: boolean;
    additionalAuthInfo: ProviderAuthInfo;
    text: string;
    json: any;
}

export interface TemplateSummary {
    resultIndex: number;
    ref: string;
    name: string;
    title: string;
    description: string;
    tags: string[];
    creates: string[];
}

export interface TemplateDetail extends Template {
    resultIndex: number | undefined;
}
