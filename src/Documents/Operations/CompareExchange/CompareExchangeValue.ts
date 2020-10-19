import { IMetadataDictionary } from "../../..";
import { ICompareExchangeValue } from "./ICompareExchangeValue";
import { MetadataDictionary } from "../../../Mapping/MetadataAsDictionary";

export class CompareExchangeValue<T> implements ICompareExchangeValue {
    public key: string;
    public index: number;
    public value: T;
    private _metadataAsDictionary: IMetadataDictionary;

    public constructor(key: string, index: number, value: T, metadata?: IMetadataDictionary) {
        this.key = key;
        this.index = index;
        this.value = value;
        this._metadataAsDictionary = metadata;
    }

    public get metadata(): IMetadataDictionary {
        if (!this._metadataAsDictionary) {
            this._metadataAsDictionary = MetadataDictionary.create();
        }
        return this._metadataAsDictionary;
    }

    public hasMetadata(): boolean {
        return !!this._metadataAsDictionary;
    }
}
