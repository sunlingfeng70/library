import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('reader_type')
export class ReaderType {
  @PrimaryColumn()
  code!: string;

  @Column()
  name!: string;

  @Column({ default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

export interface ReaderTypeView {
  code: string;
  name: string;
  enabled: boolean;
}